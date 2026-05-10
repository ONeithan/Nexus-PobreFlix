import { makeApiRequest, fetchItemDetailsFull, getDetailsUrl, playNow, fetchLocalTrailers, pickBestLocalTrailer, getVideoStreamUrl, updateFavoriteStatus, getEmbyHeaders, getSessionInfo } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { withServer } from "./jfUrl.js";
import { getConfig, getDetailsModalRuntimeConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { CollectionCacheDB } from "./collectionCacheDb.js";
import { formatOfficialRatingLabel, getYoutubeEmbedUrl } from "./utils.js";
import { getGlobalTmdbApiKey, sanitizeTmdbApiKey } from "./jmsPluginConfig.js";
import { ensureStudioHubLogoFromTmdb, ensureStudioHubManualEntry, JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT } from "./studioHubsShared.js";
import { showNotification } from "./player/ui/notification.js";
import { WATCHLIST_MODAL_ID, getWatchlistButtonText, getWatchlistTabKey, getWatchlistToast, openWatchlistModal } from "./watchlist.js";

var config = getConfig();
var labels =
  (typeof getLanguageLabels === "function" ? getLanguageLabels() : null) ||
  (config.languageLabels.[config.language] || null) ||
  (config.languageLabels.tr || null) ||
  {};

var _reviewHtmlStore = new Map();
var MODAL_ID = "jms-details-modal-root";
var _closeListeners = [];
var _open = false;
var _lastFocus = null;
var _abort = null;
var _bgAbort = null;
var _restore = null;
var _scrollSnap = null;
var _unbindKeyHandler = null;
var _currentListeners = [];
var _closing = false;
var _openOrigin = null;
var _ytApiPromise = null;
var _boxSetCache = new Map();
var _autoAddStudioHubPendingIds = new Set();
var _autoAddedStudioHubIds = new Set();
var _autoStudioHubLogoPendingIds = new Set();
var _autoStudioHubLogoResolvedIds = new Set();
var TTL_MOVIE_BOXSET = 7 * 24 * 60 * 60 * 1000;
var NESTED_MODAL_SCROLL_ALLOW_SELECTOR = [
  "#" + (MODAL_ID) + " .jmsdm-card",
  "#" + (WATCHLIST_MODAL_ID) + ".visible .monwuiwl-card",
  "#" + (WATCHLIST_MODAL_ID) + ".visible .monwuiwl-share-card"
].join(", ");

function notifyDetailsModalPlay(itemId) {
  try {
    window.dispatchEvent(new CustomEvent("jms:details-modal-play", {
      detail: { itemId: String(itemId || "") },
    }));
  } catch {}
}

function isStale(ts, maxAgeMs) {
  var t = Number(ts || 0);
  if (!t) return true;
  return (Date.now() - t) > maxAgeMs;
}

function __prefersReducedMotion() {
  try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

function __resolveOriginEl(el) {
  if (!el || !el.closest) return null;
  return (
    el.querySelector.("img.cardImage, img, .cardImage, .cardImageContainer") ||
    el.closest.(".cardImageContainer, .card, .dir-row-hero, button, a") ||
    el
  );
}

function __getRectSafe(el) {
  if (!el || !el.getBoundingClientRect) return null;
  var r = el.getBoundingClientRect();
  if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
  if (r.width < 16 || r.height < 16) return null;
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;
  if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function __calcTransform(fromRect, toRect) {
  var fromCx = fromRect.left + fromRect.width / 2;
  var fromCy = fromRect.top + fromRect.height / 2;
  var toCx = toRect.left + toRect.width / 2;
  var toCy = toRect.top + toRect.height / 2;

  var sx = fromRect.width / Math.max(1, toRect.width);
  var sy = fromRect.height / Math.max(1, toRect.height);
  var tx = fromCx - toCx;
  var ty = fromCy - toCy;

  var clamp = function(v, a, b) Math.max(a, Math.min(b, v));
  return {
    sx: clamp(sx, 0.05, 1.0),
    sy: clamp(sy, 0.05, 1.0),
    tx: clamp(tx, -2000, 2000),
    ty: clamp(ty, -2000, 2000),
  };
}

function __transformStr(t) {
  return "translate3d(" + (t.tx) + "px, " + (t.ty) + "px, 0) scale(" + (t.sx) + ", " + (t.sy) + ")";
}

function __ensureModalVisible(root) {
  try {
    if (!root) return;
    var backdropEl = root.querySelector.(".jmsdm-backdrop");
    var cardEl = root.querySelector.(".jmsdm-card");
    root.style.visibility = "visible";
    root.style.opacity = "1";
    if (backdropEl) backdropEl.style.opacity = "1";
    if (cardEl) {
      cardEl.style.transform = "";
      cardEl.style.opacity = "1";
    }
  } catch {}
}

function __animateInFromOrigin(root) {
  try {
    if (__prefersReducedMotion()) {
      __ensureModalVisible(root);
      return;
    }
    var originRect = _openOrigin.rect || null;
    if (!originRect) {
      __ensureModalVisible(root);
      return;
    }

    var backdropEl = root.querySelector.(".jmsdm-backdrop");
    var cardEl = root.querySelector.(".jmsdm-card");
    if (!cardEl || !cardEl.getBoundingClientRect) {
      __ensureModalVisible(root);
      return;
    }
    var toRect = cardEl.getBoundingClientRect();
    if (!toRect || toRect.width < 10 || toRect.height < 10) {
      __ensureModalVisible(root);
      return;
    }

    var t = __calcTransform(originRect, toRect);

    try { cardEl.style.animation = "none"; } catch {}
    cardEl.style.transformOrigin = "center center";
    cardEl.style.transform = __transformStr(t);
    cardEl.style.opacity = "0.001";

    if (backdropEl) {
      backdropEl.style.opacity = "0";
    }

    new Promise(requestAnimationFrame);

    if (cardEl.animate) {
      var a1 = cardEl.animate(
        [
          { transform: __transformStr(t), opacity: 0.001 },
          { transform: "translate3d(0,0,0) scale(1,1)", opacity: 1 }
        ],
        { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }
      );
      var a2 = backdropEl.animate
        ? backdropEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "linear", fill: "forwards" })
        : null;
      try { Promise.all([a1.finished, a2.finished].filter(Boolean)); } catch {}
    } else {
      cardEl.style.transform = "";
      cardEl.style.opacity = "1";
      if (backdropEl) backdropEl.style.opacity = "1";
    }

    __ensureModalVisible(root);
  } catch {}
}

function __animateOutToOrigin(root) {
  try {
    if (__prefersReducedMotion()) return;

    var cardEl = root.querySelector.(".jmsdm-card");
    var backdropEl = root.querySelector.(".jmsdm-backdrop");
    if (!cardEl) return;

    var originEl = __resolveOriginEl(_openOrigin.el);
    var originRect = __getRectSafe(originEl) || _openOrigin.rect || null;
    if (!originRect) return;

    var cardRect = cardEl.getBoundingClientRect();
    if (!cardRect || cardRect.width < 10 || cardRect.height < 10) return;

    var t = __calcTransform(originRect, cardRect);

    try { cardEl.style.animation = "none"; } catch {}
    try { cardEl.style.transition = "none"; } catch {}
    try { cardEl.style.willChange = "transform, opacity"; } catch {}
    if (backdropEl) {
      try { backdropEl.style.transition = "none"; } catch {}
      try { backdropEl.style.willChange = "opacity"; } catch {}
    }

    var DURATION = 380;
    var BDUR = 260;
    var EASE = "cubic-bezier(.22,.95,.25,1)";

    if (cardEl.animate) {
      var a1 = cardEl.animate(
        [
          { transform: "translate3d(0,0,0) scale(1,1)", opacity: 1 },
          { transform: __transformStr(t), opacity: 0 }
        ],
        { duration: DURATION, easing: EASE, fill: "forwards" }
      );
      var a2 = backdropEl.animate
        ? backdropEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "linear", fill: "forwards" })
        : null;
      try { Promise.all([a1.finished, a2.finished].filter(Boolean)); } catch {}
      } else {
      try {
        cardEl.style.transition = "transform " + (DURATION) + "ms " + (EASE) + ", opacity " + (DURATION) + "ms " + (EASE);
        cardEl.style.transformOrigin = "center center";
        if (backdropEl) backdropEl.style.transition = "opacity " + (BDUR) + "ms linear";
        new Promise(requestAnimationFrame);
        cardEl.style.transform = __transformStr(t);
        cardEl.style.opacity = "0";
        if (backdropEl) backdropEl.style.opacity = "0";
        new Promise(function(r) setTimeout(r, DURATION + 30));
      } catch {}
    }
  } catch {}
}

function softStopHeroMedia(root) {
  try {
    var v = root.querySelector.(".jmsdm-hero video[data-jms-hero-preview='1']");
    if (v) {
      try { v.muted = true; v.volume = 0; } catch {}
      try { v.pause(); } catch {}
    }
    var f = root.querySelector.(".jmsdm-hero iframe[data-jms-hero-preview='1']");
    if (f) {
      try { f.__ytPlayer.mute.(); } catch {}
      try { f.__ytPlayer.pauseVideo.(); } catch {}
    }
  } catch {}
}

function ensureYouTubeIframeApi() {
  if (_ytApiPromise) return _ytApiPromise;

  _ytApiPromise = new Promisefunction((resolve, reject) {
    try {
      if (window.YT.Player) return resolve(window.YT);

      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function() {
        try { if (typeof prev === "function") prev(); } catch {}
        resolve(window.YT);
      };

      var already = document.querySelector('script[data-jms-yt-api="1"]');
      if (already) return;

      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.= true;
      s.defer = true;
      s.dataset.jmsYtApi = "1";
      s.onerror = function() reject(new Error("YT iframe_api load failed"));
      document.head.appendChild(s);
    } catch (e) {
      reject(e);
    }
  });

  return _ytApiPromise;
}

function wireYoutubeEndedToBackdrop(iframeEl, onEnd, { signal } = {}) {
  try {
    ensureYouTubeIframeApi();
    if (signal.aborted) return null;
    if (!iframeEl) return null;

    if (!iframeEl.id) iframeEl.id = "jmsyt_" + (Math.random().toString(36).slice(2));

    var player = new window.YT.Playerfunction(iframeEl.id, {
      events: {
        onStateChange: (ev) {
          if (signal.aborted) return;
          if (ev.data === window.YT.PlayerState.ENDED) onEnd.();
        },
        onError: function() {
          if (signal.aborted) return;
          onEnd.();
        }
      }
    });

    iframeEl.__ytPlayer = player;
    return player;
  } catch (e) {
    return null;
  }
}

function ensureRoot() {
  var root = document.getElementById(MODAL_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = MODAL_ID;
    document.body.appendChild(root);
  }
  return root;
}

function ensureLocalCommentStyles() {
  if (document.getElementById(LOCAL_COMMENT_STYLE_ID)) return;

  var style = document.createElement("style");
  style.id = LOCAL_COMMENT_STYLE_ID;
  style.textContent = "\n    #" + (MODAL_ID) + " .jmsdm-local-comments {\n      border-top: 1px solid var(--monwui-border-light);\n      margin-top: var(--monwui-gap-xl);\n      padding-top: var(--monwui-gap-lg);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-local-comments-head {\n      margin-bottom: var(--monwui-gap-md);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-compose {\n      background: linear-gradient(180deg, hsla(0,0%,100%,.05), hsla(0,0%,100%,.03));\n      border: 1px solid var(--monwui-border-light);\n      border-radius: var(--monwui-radius-card);\n      display: flex;\n      flex-direction: column;\n      gap: var(--monwui-gap-md);\n      margin-bottom: var(--monwui-gap-lg);\n      padding: var(--monwui-gap-lg);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-textarea {\n      background: rgba(7,9,15,.52);\n      border: 1px solid hsla(0,0%,100%,.08);\n      border-radius: var(--monwui-radius-input);\n      color: var(--monwui-text-primary);\n      font: inherit;\n      line-height: 1.6;\n      min-height: 110px;\n      outline: none;\n      padding: 12px 14px;\n      resize: vertical;\n      transition: border-color var(--monwui-transition-fast), box-shadow var(--monwui-transition-fast);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-textarea:focus {\n      border-color: rgba(255,183,3,.38);\n      box-shadow: 0 0 0 3px rgba(255,183,3,.12);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-textarea::placeholder {\n      color: var(--monwui-text-muted);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-textarea:disabled {\n      cursor: not-allowed;\n      opacity: .72;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-compose-meta {\n      align-items: center;\n      display: flex;\n      flex-wrap: wrap;\n      gap: var(--monwui-gap-sm);\n      justify-content: space-between;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-hint {\n      color: var(--monwui-text-tertiary);\n      font-size: 12px;\n      line-height: 1.5;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-charcount {\n      color: var(--monwui-text-muted);\n      font-size: 12px;\n      font-variant-numeric: tabular-nums;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-compose-actions {\n      display: flex;\n      flex-wrap: wrap;\n      gap: var(--monwui-gap-sm);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comments-loading {\n      color: var(--monwui-text-tertiary);\n      font-size: 13px;\n      line-height: 1.6;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-review.is-local-own {\n      background: linear-gradient(180deg, rgba(255,183,3,.08), rgba(255,183,3,.02));\n      border-left-color: rgba(255,207,110,.92);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-review-author {\n      align-items: center;\n      display: flex;\n      flex-wrap: wrap;\n      gap: 8px;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-review-meta-row {\n      align-items: center;\n      display: flex;\n      flex-wrap: wrap;\n      gap: 8px;\n      justify-content: flex-end;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-local-comment-badge,\n    #" + (MODAL_ID) + " .jmsdm-local-comment-edited {\n      background: rgba(255,183,3,.14);\n      border: 1px solid rgba(255,183,3,.22);\n      border-radius: var(--monwui-radius-chip);\n      color: #ffe1a1;\n      font-size: 10px;\n      font-weight: 800;\n      letter-spacing: .04em;\n      padding: 3px 8px;\n      text-transform: uppercase;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-local-comment-edited {\n      background: hsla(0,0%,100%,.06);\n      border-color: hsla(0,0%,100%,.08);\n      color: var(--monwui-text-tertiary);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-local-comment-toolbar {\n      align-items: center;\n      display: flex;\n      flex-wrap: wrap;\n      gap: var(--monwui-gap-sm);\n      justify-content: space-between;\n      margin-top: var(--monwui-gap-sm);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-local-comment-actions {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 8px;\n      justify-content: flex-end;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comment-action {\n      background: none;\n      border: 1px solid hsla(0,0%,100%,.1);\n      border-radius: var(--monwui-radius-chip);\n      color: var(--monwui-text-secondary);\n      cursor: pointer;\n      font: inherit;\n      font-size: 11px;\n      font-weight: 800;\n      letter-spacing: .03em;\n      padding: 6px 10px;\n      transition: all var(--monwui-transition-fast);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comment-action:hover:not(:disabled) {\n      background: hsla(0,0%,100%,.08);\n      border-color: hsla(0,0%,100%,.18);\n      color: var(--monwui-text-primary);\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comment-action.danger:hover:not(:disabled) {\n      background: rgba(255,82,82,.12);\n      border-color: rgba(255,82,82,.22);\n      color: #ffb3b3;\n    }\n\n    #" + (MODAL_ID) + " .jmsdm-comment-action:disabled {\n      cursor: not-allowed;\n      opacity: .55;\n    }\n\n    @media (max-width: 768px) {\n      #" + (MODAL_ID) + " .jmsdm-comments-compose {\n        padding: var(--monwui-gap-md);\n      }\n\n      #" + (MODAL_ID) + " .jmsdm-local-comment-toolbar {\n        align-items: flex-start;\n        flex-direction: column;\n      }\n\n      #" + (MODAL_ID) + " .jmsdm-local-comment-actions {\n        justify-content: flex-start;\n      }\n    }\n\n    @media (max-width: 480px) {\n      #" + (MODAL_ID) + " .jmsdm-comments-compose-meta {\n        align-items: flex-start;\n        flex-direction: column;\n      }\n\n      #" + (MODAL_ID) + " .jmsdm-comments-compose-actions .jmsdm-btn {\n        width: 100%;\n      }\n    }\n  ";

  document.head.appendChild(style);
}

var LS_TMDB_LANG = 'jms_tmdb_reviews_lang';
var LOCAL_COMMENTS_ENDPOINT = "/Plugins/NexusPobreFlix/comments";
var LOCAL_COMMENT_MAX_LENGTH = 2000;
var LOCAL_COMMENT_STYLE_ID = "jms-details-modal-comments-style";


function getTmdbApiKey() {
  var direct = sanitizeTmdbApiKey(config.TmdbApiKey || config.tmdbApiKey || '');
  if (direct) return direct;
  try {
    return getGlobalTmdbApiKey();
  } catch {}
  return '';
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function getCommentsUserContext() {
  var userId = "";
  var userName = "";

  try {
    var api = window.ApiClient || window.apiClient || null;
    userId = safeText(
      api.getCurrentUserId.() ||
      api._currentUserId ||
      getSessionInfo.().userId,
      ""
    );
    userName = safeText(
      api._currentUser.Name ||
      api._currentUser.Username ||
      localStorage.getItem("currentUserName") ||
      sessionStorage.getItem("currentUserName"),
      ""
    );
  } catch {}

  return { userId, userName };
}

function buildLocalCommentHeaders(extra = {}) {
  var { userId, userName } = getCommentsUserContext();
  var headers = getEmbyHeaders({
    Accept: "application/json",
    ...extra,
  });

  if (userId) headers["X-Emby-UserId"] = userId;
  if (userName) headers["X-NexusPobreFlix-UserName"] = userName;

  return headers;
}

function requestLocalComments(path = "", options = {}) {
  var response = fetch(withServer((LOCAL_COMMENTS_ENDPOINT) + (path)), {
    method: options.method || "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: buildLocalCommentHeaders(options.headers || {}),
    body: options.body,
    signal: options.signal,
  });

  if (!response.ok) {
    var message = "HTTP " + (response.status);
    try {
      var json = response.json().catchfunction(() null);
      message = safeText(json.error || json.message, message);
    } catch {
      var text = response.text().catchfunction(() "");
      message = safeText(text, message);
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json().catchfunction(() ({}));
}

function fetchLocalComments(itemId, { signal } = {}) {
  if (!itemId) return { comments: [] };
  return requestLocalComments("/items/" + (encodeURIComponent(itemId)), { signal });
}

function upsertLocalComment(itemId, content, { signal } = {}) {
  return requestLocalComments("/items/" + (encodeURIComponent(itemId)), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: String(content || ""),
    }),
  });
}

function deleteLocalComment(commentId, { signal } = {}) {
  if (!commentId) return null;
  return requestLocalComments("/" + (encodeURIComponent(commentId)), {
    method: "DELETE",
    signal,
  });
}

function formatLocalCommentDate(ts) {
  var n = Number(ts || 0);
  if (!(n > 0)) return "";

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(n));
  } catch {
    return new Date(n).toISOString().slice(0, 16).replace("T", " ");
  }
}

function renderLocalCommentsHtml(comments = [], { currentUserId = "", deleteBusyId = "" } = {}) {
  if (!comments.length) {
    return "<div style=\"color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;\">" + (config.languageLabels.localCommentsEmpty || "Ainda não há comentários locais. Seja o primeiro a comentar.") + "</div>";
  }

  return "\n    <div class=\"jmsdm-reviews\">\n      ${comments.mapfunction((comment) {\n        var commentId = safeText(comment.Id);\n        var reviewKey = "local:${commentId || Math.random().toString(36).slice(2)}";\n        var author = escapeHtml(safeText(comment.OwnerUserName, config.languageLabels.localCommentsUserFallback || \"Usuário\"));\n        var own = normalizeIdentity(comment.OwnerUserId) === normalizeIdentity(currentUserId);\n        var createdAt = Number(comment.CreatedAtUtc || 0);\n        var updatedAt = Number(comment.UpdatedAtUtc || 0);\n        var isEdited = updatedAt > 0 && createdAt > 0 && updatedAt - createdAt > 1000;\n        var date = escapeHtml(formatLocalCommentDate(updatedAt || createdAt));\n        var fullHtml = escapeHtml(safeText(comment.Content, \"\")).replace(/\\n/g, \"<br>\");\n        var plain = safeText(comment.Content, \"\");\n        var isLong = plain.length > 220;\n        var deleting = commentId && commentId === deleteBusyId;\n\n        _reviewHtmlStore.set(reviewKey, { fullHtml, shortHtml: fullHtml, plain });\n\n        return "
          <div class="jmsdm-review${own ? " is-local-own" : ""}" data-reviewid="${escapeHtml(reviewKey)}" data-comment-id="${escapeHtml(commentId)}">
            <div class="jmsdm-review-head">
              <div class="jmsdm-review-author">
                ${author}
                ${own ? "<span class=\"jmsdm-local-comment-badge\">" + (config.languageLabels.localCommentsOwnBadge || "Você") + "</span>" : ""}
              </div>
              <div class="jmsdm-review-meta-row">
                ${isEdited ? "<span class=\"jmsdm-local-comment-edited\">" + (config.languageLabels.localCommentsEdited || "Editado") + "</span>" : ""}
                <div class="jmsdm-review-date">${date}</div>
              </div>
            </div>
            <div class="jmsdm-review-body is-collapsed" data-expanded="0">${fullHtml}</div>
            ${(isLong || own) ? "\n              <div class=\"jmsdm-local-comment-toolbar\">\n                ${isLong ? "<button class="jmsdm-review-more">${config.languageLabels.more || "Ver mais"}</button>" : "<span></span>"}\n                ${own ? "
                  <div class="jmsdm-local-comment-actions">
                    <button class="jmsdm-comment-action jmsdm-local-comment-edit" data-comment-id="${escapeHtml(commentId)}">${config.languageLabels.localCommentsEdit || "Editar"}</button>
                    <button class="jmsdm-comment-action danger jmsdm-local-comment-delete" data-comment-id="${escapeHtml(commentId)}" ${deleting ? "disabled" : ""}>${deleting ? (config.languageLabels.localCommentsDeleting || "Excluindo...") : (config.languageLabels.localCommentsDelete || "Excluir")}</button>
                  </div>
                " : ""}\n              </div>\n            " : ""}
          </div>
        ";\n      }).join(\"\")}\n    </div>\n  ";
}

function loadLocalCommentsInto(root, displayItem, { signal } = {}) {
  var host = root.querySelector.(".jmsdm-local-comments");
  if (!host) return;

  var itemId = safeText(displayItem.Id);
  if (!itemId) {
    host.innerHTML = "<div style=\"color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;\">" + (config.languageLabels.localCommentsUnavailable || "A área de comentários não pôde ser aberta para este conteúdo.") + "</div>";
    return;
  }

  var user = getCommentsUserContext();
  if (!user.userId) {
    host.innerHTML = "<div style=\"color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;\">" + (config.languageLabels.localCommentsAuthMissing || "Informações de usuário ativo não encontradas para postar comentário.") + "</div>";
    return;
  }

  var state = {
    comments: [],
    currentUserId: user.userId,
    draft: "",
    editingCommentId: "",
    saving: false,
    deletingCommentId: "",
  };

  function getEditingComment() {
    if (!state.editingCommentId) return null;
    return state.comments.findfunction((comment) safeText(comment.Id) === state.editingCommentId) || null;
  }

  function captureDraft() {
    var textarea = host.querySelector(".jmsdm-comments-textarea");
    if (textarea) state.draft = textarea.value;
  }

  function wireReviewExpand(scopeEl) {
    scopeEl.querySelectorAll.(".jmsdm-review-more").forEach(function((btn) {
      if (btn.__wired) return;
      btn.__wired = true;

      btn.addEventListenerfunction("click", (e) {
        e.preventDefault();

        var card = btn.closest(".jmsdm-review");
        var body = card.querySelector(".jmsdm-review-body");
        if (!card || !body) return;

        var id = String(card.getAttribute("data-reviewid") || "");
        var st = _reviewHtmlStore.get(id);
        if (!st) return;

        var expanded = body.getAttribute("data-expanded") === "1";
        if (!expanded) {
          body.innerHTML = st.fullHtml || "";
          body.setAttribute("data-expanded", "1");
          body.classList.remove("is-collapsed");
          btn.textContent = config.languageLabels.less || "Recolher";
        } else {
          body.innerHTML = st.shortHtml || "";
          body.setAttribute("data-expanded", "0");
          body.classList.add("is-collapsed");
          btn.textContent = config.languageLabels.more || "Ver mais";
        }
      });
    });
  }

  function render() {
    var editingComment = getEditingComment();
    var submitLabel = state.saving
      ? (config.languageLabels.localCommentsSaving || "Salvando...")
      : (editingComment
          ? (config.languageLabels.localCommentsUpdate || "Atualizar Comentário")
          : (config.languageLabels.localCommentsSubmit || "Postar Comentário"));
    var deleteBusyId = state.deletingCommentId;
    var hint = editingComment
      ? (config.languageLabels.localCommentsEditHint || "Você está editando seu comentário. Ele será atualizado ao salvar.")
      : "";
    var canSubmit = !!state.draft.trim() && !state.saving && state.draft.length <= LOCAL_COMMENT_MAX_LENGTH;

    host.innerHTML = "\n      <div class=\"jmsdm-local-comments-head\">\n        <div class=\"jmsdm-section-title\">${escapeHtml("${config.languageLabels.localCommentsTitle || "Comentários da Comunidade"} (${state.comments.length})")}</div>\n      </div>\n\n      <div class=\"jmsdm-comments-compose\">\n        <textarea\n          class=\"jmsdm-comments-textarea\"\n          rows=\"4\"\n          maxlength=\"" + (LOCAL_COMMENT_MAX_LENGTH) + "\"\n          placeholder=\"" + (escapeHtml(config.languageLabels.localCommentsPlaceholder || "O que você achou deste conteúdo?")) + "\"\n          " + (state.saving ? "disabled" : "") + "\n        >" + (escapeHtml(state.draft)) + "</textarea>\n\n        <div class=\"jmsdm-comments-compose-meta\">\n          ${hint ? "<div class="jmsdm-comments-hint">${escapeHtml(hint)}</div>" : \"\"}\n          <div class=\"jmsdm-comments-charcount\">" + (state.draft.length) + "/" + (LOCAL_COMMENT_MAX_LENGTH) + "</div>\n        </div>\n\n        <div class=\"jmsdm-comments-compose-actions\">\n          <button class=\"jmsdm-btn primary jmsdm-local-comment-submit\" " + (canSubmit ? "" : "disabled") + ">\n            " + (escapeHtml(submitLabel)) + "\n          </button>\n          ${editingComment ? "
            <button class="jmsdm-btn jmsdm-local-comment-cancel" ${state.saving ? "disabled" : ""}>
              ${escapeHtml(config.languageLabels.localCommentsCancelEdit || "Cancelar")}
            </button>
          " : ""}\n        </div>\n      </div>\n\n      <div class=\"jmsdm-comments-list\">\n        " + (renderLocalCommentsHtml(state.comments, { currentUserId: state.currentUserId, deleteBusyId ) + ")}\n      </div>\n    ";

    var textarea = host.querySelector(".jmsdm-comments-textarea");
    var submitBtn = host.querySelector(".jmsdm-local-comment-submit");
    var cancelBtn = host.querySelector(".jmsdm-local-comment-cancel");
    var countEl = host.querySelector(".jmsdm-comments-charcount");

    if (textarea && submitBtn) {
      textarea.addEventListenerfunction("input", () {
        state.draft = textarea.value;
        submitBtn.disabled = !state.draft.trim() || state.saving;
        if (countEl) countEl.textContent = (state.draft.length) + "/" + (LOCAL_COMMENT_MAX_LENGTH);
      });
    }

    if (submitBtn) {
      submitBtn.addEventListenerfunction("click", (e) {
        e.preventDefault();
        captureDraft();
        var content = state.draft.trim();
        if (!content || signal.aborted) return;

        try {
          state.saving = true;
          render();
          upsertLocalComment(itemId, content, { signal });
          if (signal.aborted || !_open) return;

          var latest = fetchLocalComments(itemId, { signal });
          state.comments = Array.isArray(latest.comments) ? latest.comments : state.comments;
          state.draft = "";
          state.editingCommentId = "";
          state.saving = false;
          render();
          window.showMessage.(config.languageLabels.localCommentsSaved || "Comentário salvo.", "success");
        } catch (err) {
          state.saving = false;
          render();
          console.warn("local comments save error:", err);
          window.showMessage.(err.message || config.languageLabels.localCommentsSaveFailed || "Não foi possível salvar o comentário.", "error");
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListenerfunction("click", (e) {
        e.preventDefault();
        state.editingCommentId = "";
        state.draft = "";
        render();
      });
    }

    host.querySelectorAll(".jmsdm-local-comment-edit").forEach(function((btn) {
      if (btn.__wired) return;
      btn.__wired = true;

      btn.addEventListenerfunction("click", (e) {
        e.preventDefault();
        captureDraft();

        var commentId = safeText(btn.getAttribute("data-comment-id"));
        var comment = state.comments.findfunction((entry) safeText(entry.Id) === commentId);
        if (!comment) return;

        state.editingCommentId = commentId;
        state.draft = safeText(comment.Content, "");
        render();

        var nextTextarea = host.querySelector(".jmsdm-comments-textarea");
        try {
          nextTextarea.focus.({ preventScroll: true });
          var end = nextTextarea.value.length || 0;
          nextTextarea.setSelectionRange.(end, end);
        } catch {}
      });
    });

    host.querySelectorAll(".jmsdm-local-comment-delete").forEach(function((btn) {
      if (btn.__wired) return;
      btn.__wired = true;

      btn.addEventListenerfunction("click", (e) {
        e.preventDefault();
        if (signal.aborted) return;

        var commentId = safeText(btn.getAttribute("data-comment-id"));
        if (!commentId) return;

        var confirmed = window.confirm.(
          config.languageLabels.localCommentsDeleteConfirm || "Tem certeza que deseja excluir seu comentário?"
        );
        if (confirmed === false) return;

        try {
          state.deletingCommentId = commentId;
          render();
          deleteLocalComment(commentId, { signal });
          if (signal.aborted || !_open) return;

          var latest = fetchLocalComments(itemId, { signal });
          state.comments = Array.isArray(latest.comments) ? latest.comments : [];
          if (state.editingCommentId === commentId) {
            state.editingCommentId = "";
            state.draft = "";
          }
          state.deletingCommentId = "";
          render();
          window.showMessage.(config.languageLabels.localCommentsDeleted || "Comentário excluído.", "success");
        } catch (err) {
          state.deletingCommentId = "";
          render();
          console.warn("local comments delete error:", err);
          window.showMessage.(err.message || config.languageLabels.localCommentsDeleteFailed || "Não foi possível excluir o comentário.", "error");
        }
      });
    });

    wireReviewExpand(host);
  }

  host.innerHTML = "<div class=\"jmsdm-comments-loading\">" + (config.languageLabels.loading || "Carregando...") + "</div>";

  try {
    var data = fetchLocalComments(itemId, { signal });
    if (signal.aborted || !_open) return;
    state.comments = Array.isArray(data.comments) ? data.comments : [];
    render();
  } catch (err) {
    if (signal.aborted) return;
    console.warn("local comments load error:", err);
    host.innerHTML = "<div style=\"color:rgba(255,255,255,.72);font-size:13px;line-height:1.6;\">" + (escapeHtml(err.message || config.languageLabels.localCommentsLoadFailed || "Não foi possível carregar os comentários.")) + "</div>";
  }
}

function wireOverviewToggle(root) {
  var over = root.querySelector.(".jmsdm-overview");
  if (!over) return;
  if (root.querySelector(".jmsdm-overview-toggle")) return;
  requestAnimationFramefunction(() {
    var needs = over.scrollHeight > 150;
    if (!needs) return;

    over.classList.add("is-collapsed");

    var btn = document.createElement("button");
    btn.className = "jmsdm-overview-toggle";
    btn.type = "button";
    btn.textContent = (config.languageLabels.more || "Ver mais");

    btn.addEventListenerfunction("click", (e) {
      e.preventDefault();
      e.stopPropagation();

      var collapsed = over.classList.toggle("is-collapsed");
      btn.textContent = collapsed
        ? (config.languageLabels.more || "Ver mais")
        : (config.languageLabels.less || "Recolher");
    });
    over.insertAdjacentElement("afterend", btn);
  });
}

function getTmdbLangPref() {
  try { return (localStorage.getItem(LS_TMDB_LANG) || '').trim(); } catch {}
  return '';
}

function getProviderId(item, key) {
  var p = item.ProviderIds || item.Providerids || item.providerIds || null;
  if (!p) return '';
  var candidates = [
    p[key],
    p[key.toLowerCase.()],
    p[key.toUpperCase.()],
    p[key === 'Tmdb' ? 'TMDb' : key],
    p[key === 'Imdb' ? 'IMDb' : key],
  ].filter(Boolean);
  return (candidates[0] || '').toString().trim();
}

function tmdbFetchJson(path, { signal } = {}) {
  var apiKey = getTmdbApiKey();
  if (!apiKey) throw new Error('TMDb API key missing');

  var base = 'https://api.themoviedb.org/3';
  var url = new URL(base + path);
  url.searchParams.set('api_key', apiKey);

  var res = fetch(url.toString(), { method: 'GET', signal });
  if (!res.ok) {
    var txt = res.text().catchfunction(() '');
    throw new Error("TMDb HTTP " + (res.status) + ": " + (txt));
  }
  return res.json();
}

function resolveTmdbIdFromImdb(imdbId, { signal } = {}) {
  if (!imdbId) return { movie: null, tv: null };
  var data = tmdbFetchJson("/find/" + (encodeURIComponent(imdbId)) + "?external_source=imdb_id", { signal });
  var movieId = Array.isArray(data.movie_results) && data.movie_results[0].id ? data.movie_results[0].id : null;
  var tvId    = Array.isArray(data.tv_results)    && data.tv_results[0].id    ? data.tv_results[0].id    : null;
  return { movie: movieId, tv: tvId };
}

function getTmdbIdForItem(item, { signal } = {}) {
  var tmdb = getProviderId(item, 'Tmdb') || getProviderId(item, 'TMDb');
  if (tmdb && /^\d+$/.test(tmdb)) return { tmdbId: Number(tmdb), kind: (item.Type === 'Series' ? 'tv' : 'movie') };
  var imdb = getProviderId(item, 'Imdb') || getProviderId(item, 'IMDb');
  if (imdb) {
    var found = resolveTmdbIdFromImdb(imdb, { signal });
    if (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'Episode') {
      if (found.tv) return { tmdbId: found.tv, kind: 'tv' };
      if (found.movie) return { tmdbId: found.movie, kind: 'movie' };
    } else {
      if (found.movie) return { tmdbId: found.movie, kind: 'movie' };
      if (found.tv) return { tmdbId: found.tv, kind: 'tv' };
    }
  }
  return { tmdbId: null, kind: null };
}

function fetchTmdbReviews(kind, tmdbId, { signal, language = null, page = 1 } = {}) {
  if (!kind || !tmdbId) return { results: [], page: 1, total_pages: 1 };
  var lang = (language != null ? language : getTmdbLangPref());

  var qp = new URLSearchParams();
  if (lang) qp.set("language", lang);
  qp.set("page", String(page || 1));

  var path = "/" + (kind) + "/" + (encodeURIComponent(tmdbId)) + "/reviews?" + (qp.toString());
  var data = tmdbFetchJson(path, { signal });
  return {
    results: Array.isArray(data.results) ? data.results : [],
    page: Number(data.page || page || 1),
    total_pages: Number(data.total_pages || 1),
    total_results: Number(data.total_results || 0),
  };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function markdownToHtmlLite(inputMd) {
  var src = String(inputMd || "");
  if (!src) return "";

  var s = escapeHtml(src).replace(/\r\n/g, "\n");

  var codeBlocks = [];
  s = s.replace(/"""([\\s\\S]*?)"""/g, function(_, code) {
    codeBlocks.push(code);
    return "@@JMS_CODEBLOCK_" + (codeBlocks.length - 1) + "@@";
  });

  var inlineCodes = [];
  s = s.replace(/"([^"]+)"/g, function(_, code) {\n    inlineCodes.push(code);\n    return "@@JMS_CODE_${inlineCodes.length - 1}@@";\n  });\n\n  s = s.replace(/\\[([^\\]]+?)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href=\"$2\">$1</a>');\n  s = s.replace(/\\*\\*([\\s\\S]+?)\\*\\*/g, \"<strong>$1</strong>\");\n  s = s.replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g, \"$1<em>$2</em>\");\n  s = s.replace(/(^|[^_])_([^_\\n]+)_(?!_)/g, \"$1<em>$2</em>\");\n  s = s.replace(/@@JMS_CODE_(\\d+)@@/g, function(m, i) {\n    var idx = Number(i);\n    return "<code>${inlineCodes[idx] || ""}</code>";\n  });\n\n  s = s.replace(/@@JMS_CODEBLOCK_(\\d+)@@/g, function(m, i) {\n    var idx = Number(i);\n    return "<pre><code>${codeBlocks[idx] || ""}</code></pre>";\n  });\n\n  var lines = s.split(\"\\n\");\n  var out = [];\n  var buf = [];\n  var mode = null;\n\n  var flush = function() {\n    if (!buf.length) return;\n    var raw = buf.join(\"\\n\").trimEnd();\n    var html = raw.replace(/\\n/g, \"<br>\");\n    if (mode === \"q\") out.push("<blockquote><p>${html}</p></blockquote>");\n    else out.push("<p>${html}</p>");\n    buf = [];\n    mode = null;\n  };\n\n  for (var i = 0; i < lines.length; i++) {\n    var ln = lines[i];\n\n    if (!ln.trim()) {\n      flush();\n      continue;\n    }\n\n    var isQuote = ln.startsWith(\"&gt;\") || ln.startsWith(\"&gt; \");\n    if (isQuote) {\n      var content = ln.replace(/^&gt;\\s?/, \"\");\n      if (mode && mode !== \"q\") flush();\n      mode = \"q\";\n      buf.push(content);\n    } else {\n      if (mode && mode !== \"p\") flush();\n      mode = \"p\";\n      buf.push(ln);\n    }\n  }\n  flush();\n\n  return out.join(\"\");\n}\n\nfunction looksLikeHtmlish(input) {\n  var s = String(input || \"\");\n  return /<\\/?(?:em|i|strong|b|u|s|p|br|div|span|ul|ol|li|blockquote|code|pre|a|spoiler)\\b/i.test(s);\n}\n\nfunction sanitizeLimitedHtml(inputHtml) {\n  var html = String(inputHtml || \"\");\n  if (!html) return \"\";\n\n  var ALLOWED_TAGS = new Set([\n    \"B\",\"I\",\"EM\",\"STRONG\",\"U\",\"S\",\n    \"P\",\"BR\",\"DIV\",\"SPAN\",\n    \"UL\",\"OL\",\"LI\",\n    \"BLOCKQUOTE\",\n    \"CODE\",\"PRE\",\n    \"A\",\n    \"SPOILER\",\n  ]);\n\n  var ALLOWED_ATTRS = {\n    A: new Set([\"href\", \"title\", \"target\", \"rel\"]),\n  };\n\n  var doc = new DOMParser().parseFromString("<div>${html}</div>", \"text/html\");\n  var root = doc.body.firstElementChild;\n\n  var walk = function(node) {\n    if (!node) return;\n    if (node.nodeType === Node.TEXT_NODE) return;\n    if (node.nodeType !== Node.ELEMENT_NODE) {\n      node.remove();\n      return;\n    }\n    var tag = node.tagName.toUpperCase();\n\n    if (tag === \"SPOILER\") {\n      var span = doc.createElement(\"span\");\n      span.className = \"jmsdm-spoiler\";\n      span.setAttribute(\"data-spoiler\", \"1\");\n\n      var spoilerLabel =\n        (config.languageLabels.spoilerClick || config.languageLabels.spoiler || \"\").toString().trim()\n        || \"Spoiler (toque para revelar)\";\n      span.setAttribute(\"data-spoiler-label\", spoilerLabel);\n      span.setAttribute(\"role\", \"button\");\n      span.setAttribute(\"tabindex\", \"0\");\n      span.setAttribute(\"aria-label\", spoilerLabel);\n\n      while (node.firstChild) span.appendChild(node.firstChild);\n      node.replaceWith(span);\n      Array.from(span.childNodes).forEach(walk);\n      return;\n    }\n\n    if (!ALLOWED_TAGS.has(tag)) {\n      var parent = node.parentNode;\n      if (!parent) return;\n      while (node.firstChild) parent.insertBefore(node.firstChild, node);\n      node.remove();\n      return;\n    }\n\n    var allowed = ALLOWED_ATTRS[tag] || new Set();\n    for (var attr of node.getAttributeNames()) {\n      var a = attr.toLowerCase();\n\n      if (a.startsWith(\"on\") || a === \"style\") {\n        node.removeAttribute(attr);\n        continue;\n      }\n\n      if (!allowed.has(attr)) {\n        node.removeAttribute(attr);\n      }\n    }\n\n    if (tag === \"A\") {\n      var href = (node.getAttribute(\"href\") || \"\").trim();\n      var ok = /^(https?:\\/\\/|mailto:|#|\\/)/i.test(href);\n      if (!ok) {\n        node.removeAttribute(\"href\");\n      } else {\n        var isExternal = /^https?:\\/\\//i.test(href);\n        if (isExternal) {\n          node.setAttribute(\"target\", \"_blank\");\n          node.setAttribute(\"rel\", \"noopener noreferrer\");\n        } else {\n          node.removeAttribute(\"target\");\n          node.removeAttribute(\"rel\");\n        }\n      }\n    }\n\n  Array.from(node.childNodes).forEach(walk);\n  };\n\n  Array.from(root.childNodes).forEach(walk);\n\n  return root.innerHTML;\n}\n\nfunction toPlainTextFromHtml(html) {\n  try {\n    var d = document.createElement(\"div\");\n    d.innerHTML = String(html || \"\");\n    return (d.textContent || \"\").trim();\n  } catch {\n    return String(html || \"\").trim();\n  }\n}\n\nfunction renderTmdbReviewsHtml(reviews = [], { showMore = false } = {}) {\n  if (!reviews.length) {\n    return "<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.noReviews || 'Nenhum comentário encontrado.'}</div>";\n  }\n  return "
    <div class="jmsdm-reviews">
      ${reviews.map(function(r) {
        var author = escapeHtml(r.author || r.author_details.username || '—');
        var date = escapeHtml((r.created_at || r.updated_at || '').toString().slice(0, 10));
        var raw = String(r.content || "");
        var baseHtml = looksLikeHtmlish(raw) ? raw : markdownToHtmlLite(raw);
        var fullHtml = sanitizeLimitedHtml(baseHtml);
        var plain = toPlainTextFromHtml(fullHtml);
        var isLong = plain.length > 220;
        var shortHtml = fullHtml;
        var id = escapeHtml(r.id || Math.random().toString(36).slice(2));

        var ratingRaw = r.author_details.rating;
        var ratingNum =
          (typeof ratingRaw === "number" && Number.isFinite(ratingRaw)) ? ratingRaw : null;
        var ratingPct =
          (ratingNum != null) ? Math.round(Math.max(0, Math.min(10, ratingNum)) * 10) : null;
        var ratingHtml =
          (ratingPct != null)
            ? "<span class=\"jmsdm-review-rating\" title=\"" + (ratingNum.toFixed(1)) + "/10\"\n                 style=\"font-size:12px;color:rgba(255,255,255,.85);font-weight:600;\">\n                 " + (ratingPct) + "%</span>"
            : "";

        _reviewHtmlStore.set(String(id), { fullHtml, shortHtml, plain });

        return "\n          <div class=\"jmsdm-review\" data-reviewid=\"" + (id) + "\">\n            <div class=\"jmsdm-review-head\">\n              <div class=\"jmsdm-review-author\">" + (author) + "</div>\n              <div style=\"display:flex;gap:10px;align-items:center;\">\n                " + (ratingHtml) + "\n                <div class=\"jmsdm-review-date\">" + (date) + "</div>\n              </div>\n            </div>\n            <div class=\"jmsdm-review-body is-collapsed\" data-expanded=\"0\">" + (shortHtml) + "</div>\n\n            ${isLong ? "<button class="jmsdm-review-more">${config.languageLabels.more || 'Ver mais'}</button>" : ''}\n          </div>\n        ";
      }).join('')}
    </div>
    ${showMore ? "\n      <div style=\"margin-top:10px;display:flex;justify-content:center;\">\n        <button class=\"jmsdm-btn jmsdm-reviews-more\">" + (config.languageLabels.loadMore || "Mais comentários") + "</button>\n      </div>\n    " : ""}
  ";\n}\n\nfunction loadTmdbReviewsInto(root, displayItem, { signal } = {}) {\n    var host = root.querySelector.('.jmsdm-tmdb-reviews');\n    if (!host) return;\n\n    host.innerHTML = "
        <button class="jmsdm-reviews-toggle" data-reviews-expanded="false">
            <span>
                ${config.languageLabels.reviewsTitle || 'Comentários'}
                <span class="jmsdm-tmdb-logo">(TMDb)</span>
                <span class="jmsdm-reviews-count">...</span>
            </span>
            <span class="toggle-icon">▼</span>
        </button>
        <div class="jmsdm-reviews-container">
            <div class="jmsdm-reviews-loading">${config.languageLabels.loading || 'Carregando...'}</div>
        </div>
    ";\n\n    var toggleBtn = host.querySelector('.jmsdm-reviews-toggle');\n    var container = host.querySelector('.jmsdm-reviews-container');\n    var countSpan = host.querySelector('.jmsdm-reviews-count');\n\n    function wireSpoilers(scopeEl) {\n        if (!scopeEl || scopeEl.__spoilerWired) return;\n        scopeEl.__spoilerWired = true;\n        scopeEl.addEventListenerfunction(\"click\", (e) {\n            var el = e.target.closest.(\".jmsdm-spoiler\");\n            if (!el || !scopeEl.contains(el)) return;\n            e.preventDefault();\n            e.stopPropagation();\n            el.classList.toggle(\"revealed\");\n        });\n    }\n\n    var toggleReviews = function() {\n        var expanded = toggleBtn.getAttribute('data-reviews-expanded') === 'true';\n        var newState = !expanded;\n\n        toggleBtn.setAttribute('data-reviews-expanded', newState);\n        toggleBtn.classList.toggle('expanded', newState);\n        container.classList.toggle('expanded', newState);\n\n        if (newState && !container.hasAttribute('data-loaded')) {\n            loadReviewsContent();\n        }\n    };\n\n    toggleBtn.addEventListener('click', toggleReviews);\n\n    var loadReviewsContent = function() {\n        try {\n            var key = getTmdbApiKey();\n            if (!key) {\n                container.innerHTML = "<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.tmdbKeyMissing || 'API Key do TMDb não configurada. Você pode adicioná-la nas configurações.'}</div>";\n                return;\n            }\n\n            var { tmdbId, kind } = getTmdbIdForItem(displayItem, { signal });\n            if (!_open || signal.aborted) return;\n\n            if (!tmdbId || !kind) {\n                container.innerHTML = "<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.tmdbIdMissing || 'ID do TMDb não encontrado.'}</div>";\n                container.setAttribute('data-loaded', 'true');\n                countSpan.textContent = '0';\n                return;\n            }\n\n            var oldLang = getTmdbLangPref();\n            var page = 1;\n            var pack = fetchTmdbReviews(kind, tmdbId, { signal, page });\n            var all = pack.results || [];\n            var INITIAL_TAKE = 3;\n            var STEP_TAKE = 3;\n            var shown = Math.min(INITIAL_TAKE, all.length);\n\n            if ((!all || !all.length) && oldLang && oldLang !== 'en-US') {\n                try {\n                    localStorage.setItem(LS_TMDB_LANG, 'en-US');\n                    page = 1;\n                    pack = fetchTmdbReviews(kind, tmdbId, { signal, page, language: \"en-US\" });\n                    all = pack.results || [];\n                } finally {\n                    try { localStorage.setItem(LS_TMDB_LANG, oldLang); } catch {}\n                }\n            }\n\n            var totalCount = (pack.total_results && pack.total_results > 0) ? pack.total_results : all.length;\n            countSpan.textContent = totalCount.toString();\n\n            if (!all.length) {\n                container.innerHTML = "<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.noReviews || 'Ainda não há comentários.'}</div>";\n                container.setAttribute('data-loaded', 'true');\n                return;\n            }\n\n            var canMore = function() {\n                var hasMoreInLoaded = shown < (all.length || 0);\n                var hasMorePages = (pack.total_pages || 1) > (pack.page || 1);\n                return hasMoreInLoaded || hasMorePages;\n            };\n\n            var render = function() {\n                var slice = (all || []).slice(0, shown);\n                container.innerHTML = renderTmdbReviewsHtml(slice, { showMore: canMore() });\n                wireExpand();\n                wireMore();\n                container.setAttribute('data-loaded', 'true');\n            };\n\n            var wireExpand = function() {\n              container.querySelectorAll('.jmsdm-review-more').forEach(function(btn) {\n                if (btn.__wired) return;\n                btn.__wired = true;\n\n                btn.addEventListenerfunction('click', (e) {\n                  e.preventDefault();\n\n                  var card = btn.closest('.jmsdm-review');\n                  var body = card.querySelector('.jmsdm-review-body');\n                  if (!card || !body) return;\n\n                  var id = String(card.getAttribute(\"data-reviewid\") || \"\");\n                  var st = _reviewHtmlStore.get(id);\n                  if (!st) return;\n\n                  var expanded = body.getAttribute('data-expanded') === '1';\n\n                  if (!expanded) {\n                    body.innerHTML = st.fullHtml || \"\";\n                    wireSpoilers(body);\n                    body.setAttribute('data-expanded', '1');\n                    body.classList.remove(\"is-collapsed\");\n                    btn.textContent = config.languageLabels.less || 'Recolher';\n                  } else {\n                    body.innerHTML = st.shortHtml || \"\";\n                    body.setAttribute('data-expanded', '0');\n                    body.classList.add(\"is-collapsed\");\n                    btn.textContent = config.languageLabels.more || 'Ver mais';\n                  }\n                });\n              });\n            };\n\n            var wireMore = function() {\n                var moreBtn = container.querySelector('.jmsdm-reviews-more');\n                if (!moreBtn || moreBtn.__wired) return;\n                moreBtn.__wired = true;\n\n                moreBtn.addEventListenerfunction('click', (e) {\n                    e.preventDefault();\n                    if (signal.aborted) return;\n                    try {\n                        moreBtn.disabled = true;\n                        moreBtn.textContent = config.languageLabels.loading || \"Carregando…\";\n                        var want = shown + STEP_TAKE;\n                        if (want <= (all.length || 0)) {\n                            shown = want;\n                            render();\n                            return;\n                        }\n\n                        shown = (all.length || 0);\n\n                        var hasNextPage = (pack.total_pages || 1) > (pack.page || 1);\n                        if (hasNextPage) {\n                            page = (pack.page || page) + 1;\n                            var nextPack = fetchTmdbReviews(kind, tmdbId, { signal, page });\n                            pack = nextPack;\n                            var next = nextPack.results || [];\n                            all = all.concat(next);\n                            shown = Math.min(shown + STEP_TAKE, all.length);\n                        }\n\n                        render();\n                    } catch (err) {\n                        if (!signal.aborted) {\n                            console.warn(\"load more reviews error:\", err);\n                            window.showMessage.(config.languageLabels.reviewsFetchFailed || \"Não foi possível obter os comentários.\", \"error\");\n                        }\n                    } finally {\n                        var b = container.querySelector('.jmsdm-reviews-more');\n                        if (b) {\n                            b.disabled = false;\n                            b.textContent = config.languageLabels.loadMore || \"Mais comentários\";\n                        }\n                    }\n                });\n            };\n\n            render();\n        } catch (e) {\n            if (!signal.aborted) {\n                console.warn('TMDb reviews error:', e);\n                container.innerHTML = "<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.5;">${config.languageLabels.reviewsFetchFailed || 'Não foi possível obter os comentários.'}</div>";\n                container.setAttribute('data-loaded', 'true');\n                countSpan.textContent = '0';\n            }\n        }\n    };\n\n    try {\n        var key = getTmdbApiKey();\n        if (key) {\n            var { tmdbId, kind } = getTmdbIdForItem(displayItem, { signal: null });\n            if (tmdbId && kind) {\n                var pack = fetchTmdbReviews(kind, tmdbId, { signal: null, page: 1 });\n                var count =\n                (pack.total_results && pack.total_results > 0)\n                  ? pack.total_results\n                  : (pack.results.length || 0);\n                countSpan.textContent = count.toString();\n            }\n        }\n    } catch (e) {\n        console.debug('Review count fetch error:', e);\n    }\n}\n\nfunction stopHeroMedia(root) {\n  try {\n    var hero = root.querySelector.(\".jmsdm-hero\");\n    var media = hero.querySelector.(\".jmsdm-hero-media\");\n    var heroImg = hero.querySelector.(\"img\");\n    var replayBtn = hero.querySelector.(\".jmsdm-hero-replay\");\n    var v = hero.querySelector.(\"video[data-jms-hero-preview='1']\");\n    if (v) {\n      try { v.pause(); } catch {}\n      try { v.removeAttribute(\"src\"); v.load(); } catch {}\n      try { v.remove(); } catch {}\n    }\n    var f = hero.querySelector.(\"iframe[data-jms-hero-preview='1']\");\n    if (f) {\n      try { f.__ytPlayer.destroy.(); } catch {}\n      try { f.__ytPlayer = null; } catch {}\n      try { f.src = \"about:blank\"; } catch {}\n      try { f.remove(); } catch {}\n    }\n    try { if (media) media.innerHTML = \"\"; } catch {}\n    try { media.remove.(); } catch {}\n    try { if (heroImg) heroImg.style.opacity = \"1\"; } catch {}\n    try { if (replayBtn) replayBtn.disabled = false; } catch {}\n    setHeroReplayVisible(replayBtn, true);\n  } catch {}\n}\n\nvar HERO_REPLAY_ICON_D =\n  \"M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z\";\n\nfunction setHeroReplayVisible(btn, visible) {\n  if (!btn) return;\n  btn.classList.toggle(\"is-visible\", !!visible);\n  btn.setAttribute(\"aria-hidden\", visible ? \"false\" : \"true\");\n}\n\nfunction ensureHeroReplayButton(root, item, { signal } = {}) {\n  var hero = root.querySelector.(\".jmsdm-hero\");\n  if (!hero) return null;\n\n  hero.style.position = hero.style.position || \"relative\";\n\n  var btn = hero.querySelector(\".jmsdm-hero-replay\");\n  if (!btn) {\n    var label =\n      (config.languageLabels.replayTrailer || config.languageLabels.playTrailer || \"\").toString().trim()\n      || \"Reproduzir trailer novamente\";\n\n    btn = document.createElement(\"button\");\n    btn.type = \"button\";\n    btn.className = \"jmsdm-btn jmsdm-hero-replay\";\n    btn.innerHTML = "${icon(HERO_REPLAY_ICON_D)}";\n    btn.setAttribute(\"aria-label\", label);\n    btn.setAttribute(\"title\", label);\n    hero.appendChild(btn);\n  }\n\n  if (!btn.__wired) {\n    btn.__wired = true;\n\n    btn.addEventListenerfunction(\"click\", (e) {\n      e.preventDefault();\n      e.stopPropagation();\n\n      if (!_open || signal.aborted) return;\n\n      try {\n        btn.disabled = true;\n        setHeroReplayVisible(btn, false);\n        startHeroTrailer(root, item, { signal });\n      } finally {\n        try { btn.disabled = false; } catch {}\n      }\n    });\n  }\n\n  return btn;\n}\n\nfunction startHeroTrailer(root, item, { signal } = {}) {\n  if (!root || !item) return;\n  var hero = root.querySelector(\".jmsdm-hero\");\n  if (!hero) return;\n\n  var replayBtn = ensureHeroReplayButton(root, item, { signal });\n  setHeroReplayVisible(replayBtn, false);\n  try { if (replayBtn) replayBtn.disabled = true; } catch {}\n\n  var media = hero.querySelector(\".jmsdm-hero-media\");\n  if (!media) {\n    media = document.createElement(\"div\");\n    media.className = \"jmsdm-hero-media\";\n    Object.assign(media.style, {\n      position: \"absolute\",\n      inset: \"0\",\n      zIndex: \"1\",\n      overflow: \"hidden\",\n      borderTopLeftRadius: \"18px\",\n      borderTopRightRadius: \"18px\",\n      pointerEvents: \"auto\",\n    });\n    hero.style.position = hero.style.position || \"relative\";\n    hero.prepend(media);\n  } else {\n    media.innerHTML = \"\";\n  }\n\n  var heroImg = hero.querySelector(\"img\");\n  var showImg = function(on) { try { if (heroImg) heroImg.style.opacity = on ? \"1\" : \"0\"; } catch {} };\n\n  try {\n    var locals = fetchLocalTrailers(item.Id, { signal });\n    if (signal.aborted) return;\n    var best = pickBestLocalTrailer(locals);\n    if (best.Id) {\n      var url = getVideoStreamUrl(\n        best.Id,\n        1280,\n        0,\n        null,\n        [\"h264\"],\n        [\"aac\"],\n        false,\n        false,\n        false,\n        { signal }\n      );\n      if (signal.aborted) return;\n      if (url) {\n        var v = document.createElement(\"video\");\n        v.dataset.jmsHeroPreview = \"1\";\n        v.autoplay = true;\n        v.muted = false;\n        v.playsInline = true;\n        v.loop = false;\n\n        v.controls = true;\n        v.preload = \"metadata\";\n        v.src = url;\n\n        Object.assign(v.style, {\n          width: \"100%\",\n          height: \"100%\",\n          objectFit: \"cover\",\n          display: \"block\",\n        });\n\n        showImg(true);\n        try { if (replayBtn) replayBtn.disabled = false; } catch {}\n\n        var backToBackdrop = function() {\n          if (signal.aborted) return;\n          try { v.pause(); } catch {}\n          try { v.removeAttribute(\"src\"); v.load(); } catch {}\n          try { v.remove(); } catch {}\n          try { media.innerHTML = \"\"; } catch {}\n          showImg(true);\n          try { if (replayBtn) replayBtn.disabled = false; } catch {}\n          setHeroReplayVisible(replayBtn, true);\n        };\n\n        v.addEventListenerfunction(\"playing\", () {\n          if (signal.aborted) return;\n          showImg(false);\n        }, { once: true });\n\n        v.addEventListener(\"ended\", backToBackdrop, { once: true });\n        v.addEventListener(\"error\", backToBackdrop, { once: true });\n\n        media.appendChild(v);\n\n        try { v.play(); } catch {}\n        return;\n      }\n    }\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"startHeroTrailer local error:\", e);\n  }\n\n  try {\n    var r = Array.isArray(item.RemoteTrailers) ? item.RemoteTrailers[0] : null;\n    var embed = r.Url ? getYoutubeEmbedUrl(r.Url) : \"\";\n    if (!embed || signal.aborted) return;\n\n    var f = document.createElement(\"iframe\");\n    f.dataset.jmsHeroPreview = \"1\";\n    f.allow = \"autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture\";\n    f.referrerPolicy = \"origin-when-cross-origin\";\n    f.allowFullscreen = true;\n    f.src = embed;\n    Object.assign(f.style, {\n      width: \"100%\",\n      height: \"100%\",\n      border: \"none\",\n      display: \"block\",\n    });\n\n    var backToBackdrop = function() {\n      if (signal.aborted) return;\n      try { f.__ytPlayer.destroy.(); } catch {}\n      try { f.__ytPlayer = null; } catch {}\n      try { f.src = \"about:blank\"; } catch {}\n      try { f.remove(); } catch {}\n      try { media.innerHTML = \"\"; } catch {}\n      showImg(true);\n      try { if (replayBtn) replayBtn.disabled = false; } catch {}\n      setHeroReplayVisible(replayBtn, true);\n    };\n\n    media.appendChild(f);\n    showImg(false);\n    try { if (replayBtn) replayBtn.disabled = false; } catch {}\n    wireYoutubeEndedToBackdrop(f, backToBackdrop, { signal });\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"startHeroTrailer remote error:\", e);\n  }\n}\n\nfunction isIOSLike() {\n  try {\n    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||\n      (navigator.platform === \"MacIntel\" && navigator.maxTouchPoints > 1);\n  } catch { return false; }\n}\n\nfunction lockScroll(lock) {\n  try {\n    var docEl = document.documentElement;\n    if (!docEl) return;\n\n    if (lock) {\n      if (_scrollSnap) return;\n\n      var y = window.scrollY || docEl.scrollTop || 0;\n      var x = window.scrollX || docEl.scrollLeft || 0;\n      var scrollbarW = (window.innerWidth || 0) - (docEl.clientWidth || 0);\n\n      _scrollSnap = { y, x, scrollbarW, usedBodyFixed: false, blocker: null };\n\n      docEl.style.scrollbarGutter = \"stable\";\n      if (scrollbarW > 0) document.body.style.paddingRight = "${scrollbarW}px";\n\n      docEl.style.overflow = \"hidden\";\n      document.body.style.overflow = \"hidden\";\n\n      var ios = isIOSLike();\n      if (ios) {\n        _scrollSnap.usedBodyFixed = true;\n        document.body.style.position = \"fixed\";\n        document.body.style.top = "-${y}px";\n        document.body.style.left = "-${x}px";\n        document.body.style.right = \"0\";\n        document.body.style.width = \"100%\";\n      }\n\n      var blocker = function(e) {\n        var target = e.target.nodeType === 1 ? e.target : e.target.parentElement;\n        if (target.closest.(NESTED_MODAL_SCROLL_ALLOW_SELECTOR)) return;\n        e.preventDefault();\n      };\n\n      window.addEventListener(\"wheel\", blocker, { passive: false });\n      window.addEventListener(\"touchmove\", blocker, { passive: false });\n      _scrollSnap.blocker = blocker;\n\n    } else {\n      if (!_scrollSnap) return;\n\n      var { y, x, blocker, usedBodyFixed } = _scrollSnap;\n\n      if (blocker) {\n        window.removeEventListener(\"wheel\", blocker);\n        window.removeEventListener(\"touchmove\", blocker);\n      }\n\n      if (usedBodyFixed) {\n        document.body.style.position = \"\";\n        document.body.style.top = \"\";\n        document.body.style.left = \"\";\n        document.body.style.right = \"\";\n        document.body.style.width = \"\";\n        document.body.style.touchAction = \"\";\n      }\n\n      document.body.style.paddingRight = \"\";\n      document.body.style.overflow = \"\";\n      docEl.style.overflow = \"\";\n      docEl.style.scrollbarGutter = \"\";\n\n      _scrollSnap = null;\n\n      window.scrollTo(x || 0, y || 0);\n    }\n  } catch {}\n}\n\n\nfunction capturePreviewState() {\n  try {\n    var slide = document.querySelector(\".swiper .swiper-slide.active, .splide__slide.is-active, .embla__slide.is-selected, .flickity-slider .is-selected, .active\");\n    if (!slide) return null;\n\n    var backdropImg = slide.querySelector(\".monwui-backdrop, .monwui-backdrop img, .backdrop img, .banner img, img\") || null;\n\n    var yt =\n      slide.querySelector('iframe[data-jms-preview=\"1\"], iframe[data-jmspreview=\"1\"], iframe[data-jmsPreview=\"1\"]') ||\n      slide.querySelector('iframe[data-jms-preview], iframe[data-jmsPreview]') ||\n      slide.querySelector('iframe[data-jms-preview=\"1\"]') ||\n      slide.querySelector('iframe[data-jms-preview=\"true\"]') ||\n      slide.querySelector('iframe[data-jms-preview]') ||\n      null;\n\n    var vid =\n      slide.querySelector('video[data-jms-preview=\"1\"], video[data-jmsPreview=\"1\"], video[data-jms-preview], video[data-jmsPreview]') ||\n      slide.querySelector(\"video\") ||\n      null;\n\n    var classes = Array.from(slide.classList);\n    var flag = function(() {\n      try { return window.__JMS_PREVIEW_PLAYBACK || null; } catch { return null; }\n    })();\n\n    return {\n      slide,\n      classes,\n      backdropOpacity: backdropImg ? backdropImg.style.opacity : null,\n      ytSrc: yt ? yt.src : null,\n      ytDisplayed: yt ? yt.style.display : null,\n      videoSrc: vid ? (vid.currentSrc || vid.src || \"\") : null,\n      videoTime: vid ? (Number.isFinite(vid.currentTime) ? vid.currentTime : 0) : 0,\n      videoPaused: vid ? !!vid.paused : true,\n      flag\n    };\n  } catch {\n    return null;\n  }\n}\n\nfunction pausePreviewNow(snap) {\n  try {\n    if (!snap.slide) return;\n\n    var yt = snap.slide.querySelector('iframe[data-jms-preview=\"1\"], iframe[data-jms-preview], iframe[data-jmsPreview]');\n    if (yt) {\n      try { yt.src = \"about:blank\"; } catch {}\n      try { yt.style.display = \"none\"; } catch {}\n    }\n\n    var vid =\n      snap.slide.querySelector('video[data-jms-preview=\"1\"], video[data-jms-preview], video[data-jmsPreview]') ||\n      snap.slide.querySelector(\"video\");\n    if (vid) {\n      try { vid.pause(); } catch {}\n    }\n  } catch {}\n}\n\nfunction restorePreviewState(snap) {\n  if (!snap.slide) return;\n\n  try {\n    var slide = snap.slide;\n    var hadVideo = snap.classes.includes(\"video-active\") || snap.classes.includes(\"intro-active\");\n    var hadTrailer = snap.classes.includes(\"trailer-active\");\n\n    slide.classList.remove(\"video-active\", \"intro-active\", \"trailer-active\");\n    if (hadVideo) slide.classList.add(\"video-active\", \"intro-active\");\n    if (hadTrailer) slide.classList.add(\"trailer-active\");\n\n    var backdropImg = slide.querySelector(\".monwui-backdrop, .monwui-backdrop img, .backdrop img, .banner img, img\") || null;\n    if (backdropImg && snap.backdropOpacity != null) backdropImg.style.opacity = snap.backdropOpacity;\n\n    var yt = slide.querySelector('iframe[data-jms-preview=\"1\"], iframe[data-jms-preview], iframe[data-jmsPreview]');\n    if (yt && snap.ytSrc) {\n      yt.style.display = snap.ytDisplayed || \"block\";\n      yt.src = snap.ytSrc;\n    }\n\n    var vid =\n      slide.querySelector('video[data-jms-preview=\"1\"], video[data-jms-preview], video[data-jmsPreview]') ||\n      slide.querySelector(\"video\");\n    if (vid && snap.videoSrc) {\n      if ((vid.currentSrc || vid.src || \"\") !== snap.videoSrc) {\n        try { vid.src = snap.videoSrc; } catch {}\n        try { vid.load(); } catch {}\n      }\n      var t = snap.videoTime || 0;\n      var shouldResume = snap.videoPaused === false;\n\n      var applyTime = function() {\n        try { vid.currentTime = t; } catch {}\n        if (shouldResume) vid.play().catchfunction(() {});\n      };\n\n      if (vid.readyState >= 1) applyTime();\n      else vid.addEventListener(\"loadedmetadata\", applyTime, { once: true });\n    }\n\n    try {\n      if (snap.flag) window.__JMS_PREVIEW_PLAYBACK = snap.flag;\n    } catch {}\n  } catch (e) {\n    console.warn(\"restorePreviewState error:\", e);\n  }\n}\n\nfunction icon(svgPathD) {\n  return "<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${svgPathD}"></path></svg>";\n}\n\nfunction getResumeTicksFromItem(it) {\n  try {\n    var t =\n      it.UserData.PlaybackPositionTicks ||\n      it.UserData.PlaybackPosition ||\n      0;\n    return Number.isFinite(t) ? t : Number(t || 0);\n  } catch {\n    return 0;\n  }\n}\n\nfunction setPlayButtonLabel(playBtn, isResume) {\n  if (!playBtn) return;\n  var txt = isResume\n    ? (config.languageLabels.devamet || config.languageLabels.devam || \"Continuar\")\n    : (config.languageLabels.playNowLabel || \"Assistir Agora\");\n\n  playBtn.innerHTML = "${icon("M8 5v14l11-7z")} ${txt}";\n}\n\nfunction getCurrentUserIdSafe() {\n  try {\n    return (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId || \"\").toString();\n  } catch {\n    return \"\";\n  }\n}\n\nfunction getResumeTicksForContainer(containerId, { signal } = {}) {\n  try {\n    var userId = getCurrentUserIdSafe();\n    if (!userId || !containerId) return 0;\n\n    var qp = new URLSearchParams();\n    qp.set(\"ParentId\", String(containerId));\n    qp.set(\"Limit\", \"1\");\n    qp.set(\"Fields\", \"UserData\");\n    qp.set(\"Filters\", \"IsResumable\");\n    qp.set(\"Recursive\", \"true\");\n    qp.set(\"EnableUserData\", \"true\");\n\n    var r = makeApiRequest(\n      "/Users/${encodeURIComponent(userId)}/Items?${qp.toString()}",\n      { signal }\n    );\n\n    var first =\n      (Array.isArray(r.Items) && r.Items[0]) ||\n      (Array.isArray(r) && r[0]) ||\n      null;\n\n    return getResumeTicksFromItem(first);\n  } catch {\n    return 0;\n  }\n}\n\nfunction toggleFavorite(itemId, makeFav, { signal } = {}) {\n  try {\n    if (!itemId) throw new Error(\"ItemId missing\");\n    updateFavoriteStatus(itemId, makeFav);\n    return true;\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"toggleFavorite error:\", e);\n    return false;\n  }\n}\n\nfunction fmtRuntime(ticks) {\n  if (!ticks) return \"\";\n  var totalMin = Math.round((ticks / 10_000_000) / 60);\n  var h = Math.floor(totalMin / 60);\n  var m = totalMin % 60;\n  if (h <= 0) return "${m} ${config.languageLabels.minutos || "min"}";\n  return "${h} ${config.languageLabels.horas || "h"} ${m} ${config.languageLabels.minutos || "min"}";\n}\n\nfunction localizeItemType(rawType) {\n  var t = String(rawType || \"\").trim();\n  if (!t) return \"\";\n\n  var ll = config.languageLabels || {};\n  var map = {\n    Movie: ll.film,\n    Series: ll.series || ll.dizi,\n    Episode: ll.episode,\n    Season: ll.season,\n    BoxSet: ll.boxset || ll.collectionTitle || ll.collection,\n    MusicAlbum: ll.album,\n    Audio: ll.track,\n    MusicArtist: ll.artist,\n  };\n\n  var byKey = ll["type_${t}"] || ll["type${t}"];\n\n  return safeText(map[t] || byKey || \"\", t);\n}\n\nfunction safeText(s, fallback = \"\") {\n  var t = (s || \"\").toString().trim();\n  return t || fallback;\n}\n\nfunction label(key, fallback = \"\") {\n  return safeText(labels.[key] || config.languageLabels.[key], fallback);\n}\n\nfunction copyTextToClipboard(value) {\n  var raw = safeText(value);\n  if (!raw) return false;\n\n  try {\n    if (navigator.clipboard.writeText) {\n      navigator.clipboard.writeText(raw);\n      return true;\n    }\n  } catch {}\n\n  try {\n    var input = document.createElement(\"textarea\");\n    input.value = raw;\n    input.setAttribute(\"readonly\", \"\");\n    input.style.position = \"fixed\";\n    input.style.top = \"-9999px\";\n    input.style.opacity = \"0\";\n    input.style.pointerEvents = \"none\";\n    document.body.appendChild(input);\n    input.focus();\n    input.select();\n    input.setSelectionRange(0, input.value.length);\n    var copied = document.execCommand(\"copy\");\n    input.remove();\n    return !!copied;\n  } catch {}\n\n  return false;\n}\n\nfunction uniqTextList(values = []) {\n  var out = [];\n  var seen = new Set();\n\n  for (var value of values) {\n    var normalized = safeText(value);\n    if (!normalized) continue;\n    var key = normalized.toLowerCase();\n    if (seen.has(key)) continue;\n    seen.add(key);\n    out.push(normalized);\n  }\n\n  return out;\n}\n\nfunction ticksToMs(value) {\n  var ticks = Number(value || 0);\n  if (!Number.isFinite(ticks) || ticks <= 0) return 0;\n  return Math.round(ticks / 10000);\n}\n\nfunction formatDateTime(ts) {\n  var date = new Date(Number(ts || 0));\n  if (Number.isNaN(date.getTime())) return \"\";\n\n  var now = new Date();\n  var sameDay = now.toDateString() === date.toDateString();\n\n  try {\n    return new Intl.DateTimeFormat(\n      config.timeLocale || config.dateLocale || \"pt-BR\",\n      sameDay\n        ? { hour: \"2-digit\", minute: \"2-digit\" }\n        : { day: \"2-digit\", month: \"2-digit\", hour: \"2-digit\", minute: \"2-digit\" }\n    ).format(date);\n  } catch {\n    return sameDay ? date.toLocaleTimeString() : date.toLocaleString();\n  }\n}\n\nfunction formatFinishTime(runtimeTicks, playbackTicks = 0) {\n  var totalTicks = Math.max(Number(runtimeTicks || 0), 0);\n  var watchedTicks = Math.max(Number(playbackTicks || 0), 0);\n  var remainingTicks = Math.max(totalTicks - watchedTicks, 0);\n  if (!remainingTicks) return \"\";\n  return formatDateTime(Date.now() + ticksToMs(remainingTicks));\n}\n\nfunction formatCommunityRating(value) {\n  var rating = Number(value);\n  return Number.isFinite(rating) ? "★ ${rating.toFixed(1)}" : \"\";\n}\n\nfunction formatBitrate(value) {\n  var bitrate = Number(value || 0);\n  if (!Number.isFinite(bitrate) || bitrate <= 0) return \"\";\n  if (bitrate >= 1000000) {\n    var mbps = bitrate / 1000000;\n    return "${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps";\n  }\n  return "${Math.round(bitrate / 1000)} kbps";\n}\n\nfunction formatChannels(value) {\n  var channels = Number(value || 0);\n  if (!Number.isFinite(channels) || channels <= 0) return \"\";\n  if (channels === 1) return \"1.0\";\n  if (channels === 2) return \"2.0\";\n  if (channels === 6) return \"5.1\";\n  if (channels === 8) return \"7.1\";\n  return "${channels} ch";\n}\n\nfunction parseNumberLike(value) {\n  if (typeof value === \"number\") {\n    return Number.isFinite(value) ? value : 0;\n  }\n\n  var raw = safeText(value);\n  if (!raw) return 0;\n\n  if (raw.includes(\"/\")) {\n    var [num, den] = raw.split(\"/\").mapfunction((part) Number(part));\n    if (Number.isFinite(num) && Number.isFinite(den) && den) {\n      return num / den;\n    }\n  }\n\n  var parsed = Number(raw);\n  return Number.isFinite(parsed) ? parsed : 0;\n}\n\nfunction getPeopleNames(item, type, limit = 8) {\n  return uniqTextList(\n    (Array.isArray(item.People) ? item.People : [])\n      .filterfunction((person) safeText(person.Type).toLowerCase() === safeText(type).toLowerCase())\n      .mapfunction((person) person.Name)\n  ).slice(0, limit);\n}\n\nfunction getActorNames(item, limit = 8) {\n  var roles = new Set([\"actor\", \"gueststar\", \"voice\"]);\n  return uniqTextList(\n    (Array.isArray(item.People) ? item.People : [])\n      .filterfunction((person) roles.has(safeText(person.Type).toLowerCase()))\n      .mapfunction((person) person.Name)\n  ).slice(0, limit);\n}\n\nfunction getStudioEntries(item, limit = 6) {\n  var out = [];\n  var seen = new Set();\n\n  for (var studio of (Array.isArray(item.Studios) ? item.Studios : [])) {\n    var name = safeText(studio.Name || studio);\n    if (!name) continue;\n\n    var key = name.toLowerCase();\n    if (seen.has(key)) continue;\n    seen.add(key);\n\n    out.push({\n      name,\n      id: safeText(studio.Id || studio.StudioId || studio.studioId)\n    });\n\n    if (out.length >= limit) break;\n  }\n\n  return out;\n}\n\nfunction getMediaStreamsByType(item, type) {\n  return (Array.isArray(item.MediaStreams) ? item.MediaStreams : [])\n    .filterfunction((stream) safeText(stream.Type).toLowerCase() === safeText(type).toLowerCase());\n}\n\nfunction getPrimaryVideoStream(item) {\n  return getMediaStreamsByType(item, \"Video\")[0] || null;\n}\n\nfunction getVideoQualityLabel(videoStream) {\n  if (!videoStream || safeText(videoStream.Type).toLowerCase() !== \"video\") return \"\";\n\n  var height = Math.max(\n    Number(videoStream.Height || 0),\n    Number(videoStream.RealHeight || 0)\n  );\n  var width = Math.max(\n    Number(videoStream.Width || 0),\n    Number(videoStream.RealWidth || 0)\n  );\n  var range = safeText(videoStream.VideoRangeType).toUpperCase();\n  var codec = safeText(videoStream.Codec).toUpperCase();\n  var fps = parseNumberLike(videoStream.RealFrameRate || videoStream.AverageFrameRate || videoStream.FrameRate);\n  var bitrate = formatBitrate(videoStream.BitRate);\n\n  var quality = \"\";\n  if (height >= 2160 || width >= 3800) quality = \"4K\";\n  else if (height >= 1440) quality = \"1440p\";\n  else if (height >= 1080 || width >= 1900) quality = \"1080p\";\n  else if (height >= 720) quality = \"720p\";\n  else if (height >= 480) quality = \"480p\";\n  else if (height > 0) quality = "${Math.round(height)}p";\n\n  var dynamicRange = range.includes(\"DOVI\")\n    ? \"Dolby Vision\"\n    : (range.includes(\"HDR\") ? \"HDR\" : \"\");\n  var fpsText = fps > 0 ? "${fps >= 10 ? fps.toFixed(0) : fps.toFixed(2)} fps".replace(/\\.00(?= fps)/, \"\") : \"\";\n\n  return [quality, dynamicRange, codec, fpsText, bitrate].filter(Boolean).join(\" • \");\n}\n\nfunction formatAudioStream(stream) {\n  var language = safeText(stream.DisplayLanguage || stream.Language || stream.LanguageCode);\n  var codec = safeText(stream.Codec).toUpperCase();\n  var channels = formatChannels(stream.Channels);\n  var bitrate = formatBitrate(stream.BitRate);\n  var tags = [language, codec, channels, bitrate].filter(Boolean);\n  var flags = [];\n  if (stream.IsDefault) flags.push(label(\"default\", \"Padrão\"));\n  if (stream.IsExternal) flags.push(label(\"external\", \"Externo\"));\n  if (stream.Title) flags.push(safeText(stream.Title));\n  return [tags.join(\" • \"), flags.join(\" • \")].filter(Boolean).join(\" - \");\n}\n\nfunction formatSubtitleStream(stream) {\n  var language = safeText(stream.DisplayLanguage || stream.Language || stream.LanguageCode);\n  var codec = safeText(stream.Codec).toUpperCase();\n  var title = safeText(stream.DisplayTitle || stream.Title);\n  var flags = [];\n  if (stream.IsDefault) flags.push(label(\"default\", \"Padrão\"));\n  if (stream.IsForced) flags.push(label(\"forced\", \"Forçado\"));\n  if (stream.IsExternal) flags.push(label(\"external\", \"Externo\"));\n  return [language, codec, title, flags.join(\" • \")].filter(Boolean).join(\" • \");\n}\n\nfunction renderPreviewStats(stats = []) {\n  if (!stats.length) return \"\";\n  return "
    <div class="jmsdm-preview-stats">
      ${stats.mapfunction((stat) "\n        <div class=\"jmsdm-preview-stat\">\n          <div class=\"jmsdm-preview-stat-label\">" + (escapeHtml(stat.label)) + "</div>\n          <div class=\"jmsdm-preview-stat-value\">" + (escapeHtml(stat.value)) + "</div>\n        </div>\n      ").join("")}
    </div>
  ";\n}\n\nfunction renderPreviewFieldSection(title, fields = []) {\n  var visible = (Array.isArray(fields) ? fields : []).filterfunction((field) safeText(field.value));\n  if (!visible.length) return \"\";\n\n  return "
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <div class="jmsdm-preview-field-list">
        ${visible.mapfunction((field) "\n          <div class=\"jmsdm-preview-field\">\n            <div class=\"jmsdm-preview-field-label\">" + (escapeHtml(field.label)) + "</div>\n            <div class=\"jmsdm-preview-field-value\">" + (escapeHtml(field.value)) + "</div>\n          </div>\n        ").join("")}
      </div>
    </section>
  ";\n}\n\nfunction renderPreviewListSection(title, items = []) {\n  var visible = (Array.isArray(items) ? items : []).filter(Boolean);\n  if (!visible.length) return \"\";\n\n  return "
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <ul class="jmsdm-preview-list">
        ${visible.mapfunction((item) "<li>" + (escapeHtml(item)) + "</li>").join("")}
      </ul>
    </section>
  ";\n}\n\nfunction renderPreviewTagSection(title, items = []) {\n  var visible = (Array.isArray(items) ? items : []).filter(Boolean);\n  if (!visible.length) return \"\";\n\n  return "
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <div class="jmsdm-preview-tags">
        ${visible.mapfunction((item) "<span class=\"jmsdm-preview-tag\">" + (escapeHtml(item)) + "</span>").join("")}
      </div>
    </section>
  ";\n}\n\nfunction renderPreviewChips(chips = []) {\n  var visible = (Array.isArray(chips) ? chips : []).filterfunction((chip) safeText(chip.text));\n  if (!visible.length) return \"\";\n\n  var openTitle = label(\"watchlistPreviewStudioAdd\", \"Adicionar à coleção de estúdio\");\n\n  return "
    <div class="jmsdm-preview-chips">
      ${visible.mapfunction((chip) {
        var chipText = safeText(chip.text);
        var studioId = safeText(chip.studioId);
        var studioName = safeText(chip.studioName, chipText);
        var className = [
          "jmsdm-preview-chip",
          chip.accent ? "accent" : "",
          studioId ? "jmsdm-preview-tag-button" : ""
        ].filter(Boolean).join(" ");

        if (!studioId) {
          return "<span class=\"" + (className) + "\">" + (escapeHtml(chipText)) + "</span>";
        }

        return "\n          <span\n            class=\"" + (className) + "\"\n            role=\"button\"\n            tabindex=\"0\"\n            data-jmsdm-studio-id=\"" + (escapeHtml(studioId)) + "\"\n            data-jmsdm-studio-name=\"" + (escapeHtml(studioName)) + "\"\n            title=\"" + (escapeHtml(openTitle)) + "\"\n            aria-label=\"${escapeHtml("${studioName} - ${openTitle}")}\"\n          >" + (escapeHtml(chipText)) + "</span>\n        ";
      }).join("")}
    </div>
  ";\n}\n\nfunction renderPreviewStudioSection(title, studios = []) {\n  var visible = (Array.isArray(studios) ? studios : []).filterfunction((studio) safeText(studio.name));\n  if (!visible.length) return \"\";\n\n  var openTitle = label(\"watchlistPreviewStudioAdd\", \"Adicionar à coleção de estúdio\");\n\n  return "
    <section class="jmsdm-preview-section">
      <h4 class="jmsdm-preview-section-title">${escapeHtml(title)}</h4>
      <div class="jmsdm-preview-tags">
        ${visible.mapfunction((studio) {
          var name = safeText(studio.name);
          var studioId = safeText(studio.id);
          if (!studioId) {
            return "<span class=\"jmsdm-preview-tag\">" + (escapeHtml(name)) + "</span>";
          }

          return "\n            <button\n              type=\"button\"\n              class=\"jmsdm-preview-tag jmsdm-preview-tag-button\"\n              data-jmsdm-studio-id=\"" + (escapeHtml(studioId)) + "\"\n              data-jmsdm-studio-name=\"" + (escapeHtml(name)) + "\"\n              title=\"" + (escapeHtml(openTitle)) + "\"\n              aria-label=\"${escapeHtml("${name} - ${openTitle}")}\"\n            >" + (escapeHtml(name)) + "</button>\n          ";
        }).join("")}
      </div>
    </section>
  ";\n}\n\nfunction notifyStudioHubResult(message, type = \"success\", icon = \"building\", duration = 2600) {\n  var cleanMessage = safeText(message);\n  if (!cleanMessage) return;\n\n  try {\n    showNotification(\n      "<i class="fas fa-${icon}" style="margin-right:8px;"></i> ${cleanMessage}",\n      duration,\n      type\n    );\n  } catch {}\n\n  window.showMessage.(cleanMessage, type === \"error\" ? \"error\" : \"success\");\n}\n\nfunction setStudioHubLoadingState(targetEl, isLoading) {\n  var el = targetEl.closest.(\"[data-jmsdm-studio-id]\") || targetEl;\n  if (!el) return false;\n\n  if (isLoading) {\n    if (el.__studioHubBusy) return false;\n    el.__studioHubBusy = true;\n    el.__studioHubOriginalHtml = el.innerHTML;\n    el.classList.add(\"is-loading\");\n    el.setAttribute(\"aria-busy\", \"true\");\n    el.style.pointerEvents = \"none\";\n    el.style.opacity = \"0.82\";\n    el.innerHTML = "<i class="fas fa-spinner fa-spin" aria-hidden="true" style="margin-right:6px;"></i>${el.__studioHubOriginalHtml || ""}";\n    try {\n      if (\"disabled\" in el) el.disabled = true;\n    } catch {}\n    return true;\n  }\n\n  if (el.__studioHubOriginalHtml != null) {\n    el.innerHTML = el.__studioHubOriginalHtml;\n  }\n  el.__studioHubOriginalHtml = null;\n  el.__studioHubBusy = false;\n  el.classList.remove(\"is-loading\");\n  el.removeAttribute(\"aria-busy\");\n  el.style.pointerEvents = \"\";\n  el.style.opacity = \"\";\n  try {\n    if (\"disabled\" in el) el.disabled = false;\n  } catch {}\n  return true;\n}\n\nfunction maybeAutoEnsureStudioHub(studioId, studioName) {\n  var cleanStudioId = safeText(studioId);\n  var cleanStudioName = safeText(studioName);\n  if (!cleanStudioId || !cleanStudioName) {\n    return { attempted: false, added: false };\n  }\n\n  if (config.currentUserIsAdmin !== true || config.studioHubsAutoAddFromWatchlistCopy !== true) {\n    return { attempted: false, added: false };\n  }\n\n  if (_autoAddStudioHubPendingIds.has(cleanStudioId)) {\n    return { attempted: false, added: false, skipped: true, pending: true };\n  }\n\n  if (_autoAddedStudioHubIds.has(cleanStudioId)) {\n    return { attempted: false, added: false, skipped: true, existing: true };\n  }\n\n  _autoAddStudioHubPendingIds.add(cleanStudioId);\n  try {\n    var result = ensureStudioHubManualEntry({\n      studioId: cleanStudioId,\n      name: cleanStudioName\n    });\n    _autoAddedStudioHubIds.add(cleanStudioId);\n\n    if (result.created) {\n      try {\n        window.dispatchEvent(new CustomEvent(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, {\n          detail: {\n            source: \"details-modal-auto-add\",\n            studioId: cleanStudioId,\n            studioName: cleanStudioName,\n            entry: result.entry || null,\n            entries: Array.isArray(result.entries) ? result.entries : []\n          }\n        }));\n      } catch {}\n    }\n\n    return {\n      attempted: true,\n      added: result.created === true,\n      existing: result.existing === true,\n      entry: result.entry || null,\n      entries: Array.isArray(result.entries) ? result.entries : []\n    };\n  } catch (error) {\n    return {\n      attempted: true,\n      added: false,\n      error\n    };\n  } finally {\n    _autoAddStudioHubPendingIds.delete(cleanStudioId);\n  }\n}\n\nfunction maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, { entries = null } = {}) {\n  var cleanStudioId = safeText(studioId);\n  var cleanStudioName = safeText(studioName);\n  if (!cleanStudioId || !cleanStudioName) {\n    return { attempted: false, uploaded: false };\n  }\n\n  if (config.currentUserIsAdmin !== true || config.studioHubsAutoAddFromWatchlistCopy !== true) {\n    return { attempted: false, uploaded: false };\n  }\n\n  if (_autoStudioHubLogoPendingIds.has(cleanStudioId)) {\n    return { attempted: false, uploaded: false, skipped: true, pending: true };\n  }\n\n  if (_autoStudioHubLogoResolvedIds.has(cleanStudioId)) {\n    return { attempted: false, uploaded: false, skipped: true };\n  }\n\n  _autoStudioHubLogoPendingIds.add(cleanStudioId);\n  try {\n    var result = ensureStudioHubLogoFromTmdb({\n      studioId: cleanStudioId,\n      name: cleanStudioName,\n      manualEntries: Array.isArray(entries) ? entries : null\n    });\n    _autoStudioHubLogoResolvedIds.add(cleanStudioId);\n\n    return {\n      attempted: result.attempted !== false,\n      uploaded: result.uploaded === true,\n      skipped: result.skipped === true,\n      reason: safeText(result.reason),\n      entry: result.entry || null,\n      entries: Array.isArray(result.entries) ? result.entries : []\n    };\n  } catch (error) {\n    return {\n      attempted: true,\n      uploaded: false,\n      error\n    };\n  } finally {\n    _autoStudioHubLogoPendingIds.delete(cleanStudioId);\n  }\n}\n\nfunction fetchSimilarItems(itemId, { signal, limit = 12 } = {}) {\n  try {\n    var userId =\n      (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    if (!userId) return [];\n    var r = makeApiRequest(\n      "/Items/${encodeURIComponent(itemId)}/Similar?UserId=${encodeURIComponent(userId)}&Limit=${encodeURIComponent(limit)}&Fields=Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData",\n      { signal }\n    );\n    return Array.isArray(r.Items) ? r.Items : [];\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"fetchSimilarItems error:\", e);\n    return [];\n  }\n}\n\nfunction fetchMoviesByGenres(genres = [], { signal, limit = 12 } = {}) {\n  try {\n    var userId =\n      (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    if (!userId || !genres.length) return [];\n    var qp = new URLSearchParams();\n    qp.set(\"UserId\", userId);\n    qp.set(\"IncludeItemTypes\", \"Movie\");\n    qp.set(\"Limit\", String(limit));\n    qp.set(\"Recursive\", \"true\");\n    qp.set(\"Fields\", \"Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData\");\n    qp.set(\"Genres\", genres.slice(0, 3).join(\"|\"));\n    qp.set(\"SortBy\", \"CommunityRating,ProductionYear,SortName\");\n    qp.set(\"SortOrder\", \"Descending\");\n    var r = makeApiRequest("/Items?${qp.toString()}", { signal });\n    return Array.isArray(r.Items) ? r.Items : [];\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"fetchMoviesByGenres error:\", e);\n    return [];\n  }\n}\n\nfunction fetchMoviesByPeople(people = [], { signal, limit = 12 } = {}) {\n  try {\n    var userId =\n      (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    var personIds = (people || []).map(function(p) p.Id).filter(Boolean).slice(0, 3);\n    if (!userId || !personIds.length) return [];\n\n    var qp = new URLSearchParams();\n    qp.set(\"UserId\", userId);\n    qp.set(\"IncludeItemTypes\", \"Movie\");\n    qp.set(\"Limit\", String(limit));\n    qp.set(\"Recursive\", \"true\");\n    qp.set(\"Fields\", \"Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData\");\n    qp.set(\"PersonIds\", personIds.join(\",\"));\n    qp.set(\"SortBy\", \"CommunityRating,ProductionYear,SortName\");\n    qp.set(\"SortOrder\", \"Descending\");\n    var r = makeApiRequest("/Items?${qp.toString()}", { signal });\n    return Array.isArray(r.Items) ? r.Items : [];\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"fetchMoviesByPeople error:\", e);\n    return [];\n  }\n}\n\nfunction getPrimaryImageUrlMini(it) {\n  var tag = it.ImageTags.Primary;\n  if (!tag) return \"\";\n  return withServer(\n    "/Items/${encodeURIComponent(it.Id)}/Images/Primary?tag=${encodeURIComponent(tag)}&quality=85&maxWidth=320"\n  );\n}\n\nfunction getHeroPrimaryImageUrl(it, { maxWidth = 1280 } = {}) {\n  try {\n    if (!it.Id) return \"\";\n\n    var primaryTag = it.ImageTags.Primary || it.PrimaryImageTag;\n    if (primaryTag) {\n      return withServer(\n        "/Items/${encodeURIComponent(it.Id)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}&quality=90&maxWidth=${encodeURIComponent(maxWidth)}"\n      );\n    }\n\n    var albumPrimaryTag = it.AlbumPrimaryImageTag;\n    var albumId = it.AlbumId || it.ParentId;\n    if (albumPrimaryTag && albumId) {\n      return withServer(\n        "/Items/${encodeURIComponent(albumId)}/Images/Primary?tag=${encodeURIComponent(albumPrimaryTag)}&quality=90&maxWidth=${encodeURIComponent(maxWidth)}"\n      );\n    }\n  } catch {}\n\n  return \"\";\n}\n\nfunction getEpisodeImageUrlMini(ep, { maxWidth = 280 } = {}) {\n  try {\n    if (!ep.Id) return \"\";\n\n    var primaryTag = ep.ImageTags.Primary;\n    if (primaryTag) {\n      return withServer(\n        "/Items/${encodeURIComponent(ep.Id)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}"\n      );\n    }\n\n    var seriesPrimary = ep.SeriesPrimaryImageTag;\n    if (seriesPrimary && ep.SeriesId) {\n      return withServer(\n        "/Items/${encodeURIComponent(ep.SeriesId)}/Images/Primary?tag=${encodeURIComponent(seriesPrimary)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}"\n      );\n    }\n\n    var pbt = Array.isArray(ep.ParentBackdropImageTags) ? ep.ParentBackdropImageTags[0] : null;\n    if (pbt) {\n      var parent = ep.SeasonId || ep.ParentId || ep.SeriesId;\n      if (parent) {\n        return withServer(\n          "/Items/${encodeURIComponent(parent)}/Images/Backdrop/0?tag=${encodeURIComponent(pbt)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}"\n        );\n      }\n    }\n  } catch {}\n\n  return \"\";\n}\n\nfunction getAudioImageUrlMini(track, { maxWidth = 260, fallbackAlbumId = \"\" } = {}) {\n  try {\n    if (!track.Id) return \"\";\n\n    var primaryTag = track.ImageTags.Primary || track.PrimaryImageTag;\n    if (primaryTag) {\n      return withServer(\n        "/Items/${encodeURIComponent(track.Id)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}"\n      );\n    }\n\n    var albumPrimaryTag = track.AlbumPrimaryImageTag;\n    var albumId = track.AlbumId || fallbackAlbumId || track.ParentId;\n    if (albumPrimaryTag && albumId) {\n      return withServer(\n        "/Items/${encodeURIComponent(albumId)}/Images/Primary?tag=${encodeURIComponent(albumPrimaryTag)}&quality=85&maxWidth=${encodeURIComponent(maxWidth)}"\n      );\n    }\n  } catch {}\n\n  return \"\";\n}\n\nfunction renderMiniCards(items = []) {\n  if (!items.length) {\n    return "<div class="jmsdm-empty-state" style="color:rgba(255,255,255,.6);font-size:14px;padding:20px;text-align:center;">${config.languageLabels.contentNotFound || "Nenhum conteúdo semelhante encontrado."}</div>";\n  }\n\n  return "
    <div class="jmsdm-minicards">
      ${items.mapfunction((it) {
        var img = getPrimaryImageUrlMini(it);
        var title = safeText(it.Name, "");
        var year = it.ProductionYear ? "(" + (it.ProductionYear) + ")" : "";
        var rating = it.CommunityRating
          ? true
          : false;

        return "\n          <div class=\"jmsdm-minicard\" data-itemid=\"" + (it.Id) + "\" title=\"" + (escapeHtml(title)) + "\">\n            <div class=\"jmsdm-minicard-img\">\n              ${\n                img\n                  ? "<img src="${img}" alt="${escapeHtml(title)}" loading="lazy" decoding="async">"\n                  : "<div class="jmsdm-skeleton" style="width:100%;height:100%;"></div>"\n              }\n\n              <div class=\"jmsdm-minicard-overlay\" aria-hidden=\"true\">\n                <div class=\"jmsdm-minicard-play\">\n                  " + (icon("M8 5v14l11-7z")) + "\n                </div>\n              </div>\n            </div>\n\n            <div class=\"jmsdm-minicard-title\">\n              <div class=\"jmsdm-minicard-name\">" + (escapeHtml(title)) + "</div>\n\n              <div class=\"jmsdm-minicard-meta\">\n                ${year ? "<span class="jmsdm-minicard-year">${escapeHtml(year)}</span>" : \"\"}\n                ${rating ? "<span class="jmsdm-minicard-rating">★ ${it.CommunityRating.toFixed(1)}</span>" : \"\"}\n              </div>\n            </div>\n          </div>\n        ";
      }).join("")}
    </div>
  ";\n}\n\nfunction fetchSeasonsForSeries(seriesId, { signal } = {}) {\n  try {\n    var userId = (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    var r = makeApiRequest(\n      "/Shows/${encodeURIComponent(seriesId)}/Seasons?UserId=${encodeURIComponent(userId)}&Fields=Id,Name,IndexNumber,UserData",\n      { signal }\n    );\n    var items = Array.isArray(r.Items) ? r.Items : [];\n    return items.sortfunction((a, b) (a.IndexNumber || 0) - (b.IndexNumber || 0));\n  } catch (e) {\n    if (signal.aborted) return [];\n    console.warn(\"fetchSeasonsForSeries error:\", e);\n    return [];\n  }\n}\n\nfunction fetchEpisodesFor(seriesId, seasonId, { signal } = {}) {\n  try {\n    var userId = (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    var qp = new URLSearchParams();\n    qp.set(\n      \"Fields\",\n      \"Overview,IndexNumber,ParentIndexNumber,UserData,Id,Name,ImageTags,PrimaryImageAspectRatio,SeriesPrimaryImageTag,ParentBackdropImageTags\"\n    );\n    qp.set(\"UserId\", userId);\n    qp.set(\"Limit\", \"1000\");\n    if (seasonId) qp.set(\"SeasonId\", seasonId);\n\n    var r = makeApiRequest(\n      "/Shows/${encodeURIComponent(seriesId)}/Episodes?${qp.toString()}",\n      { signal }\n    );\n    var items = Array.isArray(r.Items) ? r.Items : [];\n    return items.sortfunction((a, b) {\n      var sa = a.ParentIndexNumber || 0;\n      var sb = b.ParentIndexNumber || 0;\n      if (sa !== sb) return sa - sb;\n      var ea = a.IndexNumber || 0;\n      var eb = b.IndexNumber || 0;\n      return ea - eb;\n    });\n  } catch (e) {\n    if (signal.aborted) return [];\n    console.warn(\"fetchEpisodesFor error:\", e);\n    return [];\n  }\n}\n\nfunction renderSkeleton(root) {\n  root.innerHTML = "
    <div class="jmsdm-backdrop" role="dialog" aria-modal="true">
      <div class="jmsdm-card" tabindex="-1">
        <div class="jmsdm-content">
          <div class="jmsdm-hero">
            <div class="jmsdm-topbar">
              <button class="jmsdm-close" aria-label="${config.languageLabels.close || config.languageLabels.kapat || "Fechar"}">✕</button>
            </div>
          </div>
          <div class="jmsdm-body">
            <div class="jmsdm-left">
              <div class="jmsdm-skeleton" style="width:65%;height:18px;margin-top:6px;"></div>
              <div class="jmsdm-skeleton" style="width:45%;height:12px;margin-top:10px;"></div>
              <div class="jmsdm-skeleton" style="width:96%;height:10px;margin-top:18px;"></div>
              <div class="jmsdm-skeleton" style="width:92%;height:10px;margin-top:8px;"></div>
              <div class="jmsdm-skeleton" style="width:78%;height:10px;margin-top:8px;"></div>
              <div style="margin-top:16px;display:flex;gap:10px;">
                <div class="jmsdm-skeleton" style="width:120px;height:36px;"></div>
                <div class="jmsdm-skeleton" style="width:150px;height:36px;"></div>
              </div>
            </div>
            <div class="jmsdm-right">
              <div class="jmsdm-skeleton" style="width:40%;height:12px;margin-top:6px;"></div>
              <div class="jmsdm-skeleton" style="width:100%;height:60px;margin-top:12px;"></div>
              <div class="jmsdm-skeleton" style="width:100%;height:60px;margin-top:10px;"></div>
              <div class="jmsdm-skeleton" style="width:100%;height:60px;margin-top:10px;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ";\n}\n\nfunction cleanupEventListeners() {\n  _currentListeners.forEach(function(({ element, event, handler }) {\n    if (element && element.removeEventListener) element.removeEventListener(event, handler);\n  });\n  _currentListeners = [];\n}\n\nfunction cleanupCloseListeners() {\n  try {\n    _closeListeners.forEach(function(({ element, event, handler }) {\n      if (element && element.removeEventListener) element.removeEventListener(event, handler);\n    });\n  } catch {}\n  _closeListeners = [];\n}\n\nfunction addCloseListener(element, event, handler) {\n  if (!element || !handler) return function() {};\n  element.addEventListener(event, handler);\n  _closeListeners.push({ element, event, handler });\n  return function() {\n    try { element.removeEventListener(event, handler); } catch {}\n    _closeListeners = _closeListeners.filter(\n      function(l) !(l.element === element && l.event === event && l.handler === handler)\n    );\n  };\n}\n\nfunction addEventListener(element, event, handler) {\n  if (!element || !handler) return function() {};\n  element.addEventListener(event, handler);\n  _currentListeners.push({ element, event, handler });\n  return function() {\n    element.removeEventListener(event, handler);\n    _currentListeners = _currentListeners.filter(\n      function(l) !(l.element === element && l.event === event && l.handler === handler)\n    );\n  };\n}\n\nfunction wireCloseHandlers(root, closeFn) {\n  var backdrop = root.querySelector(\".jmsdm-backdrop\");\n  var closeBtn = root.querySelector(\".jmsdm-close\");\n\n  cleanupCloseListeners();\n  var handleCloseClick = function(e) {\n    e.preventDefault();\n    e.stopPropagation();\n    closeFn();\n  };\n\n  var handleBackdropClick = function(e) {\n    var card = root.querySelector(\".jmsdm-card\");\n    if (card && !card.contains(e.target)) closeFn();\n  };\n\n  var handleEscape = function(e) {\n    if (e.key === \"Escape\") {\n      e.preventDefault();\n      closeFn();\n    }\n  };\n\n  addCloseListener(closeBtn, \"click\", handleCloseClick);\n  addCloseListener(backdrop, \"mousedown\", handleBackdropClick);\n  addCloseListener(window, \"keydown\", handleEscape);\n\n  return cleanupCloseListeners;\n}\n\nfunction focusFirst(root) {\n  var close = root.querySelector(\".jmsdm-close\");\n  var card = root.querySelector(\".jmsdm-card\");\n  try {\n    if (close && typeof close.focus === \"function\") close.focus();\n    else if (card && typeof card.focus === \"function\") card.focus();\n  } catch {}\n}\n\nfunction forceHideHoverOverlays() {\n  try {\n    var sel =\n      \".swiper .swiper-slide.active, .splide__slide.is-active, .embla__slide.is-selected, \" +\n      \".flickity-slider .is-selected, .active\";\n    var slide = document.querySelector(sel);\n    if (!slide) return;\n\n    var overlays = slide.querySelectorAll(\".jms-details-overlay\");\n    overlays.forEach(function((wrap) {\n      try { wrap.classList.remove(\"is-hover\"); } catch {}\n      try { wrap.style.display = \"none\"; } catch {}\n    });\n  } catch {}\n}\n\nexport function closeDetailsModal() {\n  if (!_open || _closing) return;\n  _closing = true;\n\n  cleanupCloseListeners();\n  cleanupEventListeners();\n\n  if (_unbindKeyHandler) {\n    _unbindKeyHandler();\n    _unbindKeyHandler = null;\n  }\n\n  try {\n    if (_abort && !_abort.signal.aborted) {\n      _abort.abort();\n      _abort = null;\n    }\n  } catch {}\n\n  var root = document.getElementById(MODAL_ID);\n  if (root) {\n    softStopHeroMedia(root);\n    __animateOutToOrigin(root);\n    stopHeroMedia(root);\n    try { root.innerHTML = \"\"; } catch {}\n    try { root.remove(); } catch {}\n  }\n\n  lockScroll(false);\n  forceHideHoverOverlays();\n\n  var snap = _restore;\n  _restore = null;\n  if (snap) {\n    setTimeoutfunction(() { try { restorePreviewState(snap); } catch {} }, 100);\n  }\n\n  var lastFocusEl = _lastFocus;\n  try {\n    if (lastFocusEl && typeof lastFocusEl.focus === \"function\" && document.body.contains(lastFocusEl)) {\n      setTimeoutfunction(() { try { lastFocusEl.focus({ preventScroll: true }); } catch {} }, 50);\n    }\n  } catch {}\n\n  _open = false;\n  _lastFocus = null;\n  _openOrigin = null;\n  _closing = false;\n}\n\nfunction uniqById(items = [], seen = new Set()) {\n  var out = [];\n  for (var it of items || []) {\n    var id = it.Id ? String(it.Id) : \"\";\n    if (!id) continue;\n    if (seen.has(id)) continue;\n    seen.add(id);\n    out.push(it);\n  }\n  return out;\n}\n\nfunction getBoxSetForMovieCached(movieId, { signal } = {}) {\n  var cacheKey = String(movieId || \"\");\n  if (cacheKey && _boxSetCache.has(cacheKey)) return _boxSetCache.get(cacheKey);\n\n  var cached = CollectionCacheDB.getMovieBoxset(movieId).catchfunction(() null);\n\n  if (cached && !isStale(cached.updatedAt, TTL_MOVIE_BOXSET)) {\n    var hit = cached.boxsetId ? { id: cached.boxsetId, name: cached.boxsetName } : null;\n    if (cacheKey) _boxSetCache.set(cacheKey, hit);\n    return hit;\n  }\n\n  var live = getBoxSetForMovie(movieId, { signal });\n  CollectionCacheDB.setMovieBoxset(movieId, live.id || \"\", live.name || \"\");\n  return live;\n}\n\nfunction getBoxSetForMovie(movieId, { signal } = {}) {\n  try {\n    var cacheKey = String(movieId || \"\");\n    if (cacheKey && _boxSetCache.has(cacheKey)) return _boxSetCache.get(cacheKey);\n\n    var userId = ApiClient.getCurrentUserId();\n    if (!userId || !movieId) return null;\n\n    try {\n      var anc = makeApiRequest(\n        "/Items/${encodeURIComponent(movieId)}/Ancestors?UserId=${encodeURIComponent(userId)}",\n        { signal }\n      );\n      var list = Array.isArray(anc) ? anc : (anc.Items || []);\n      var box = (list || []).find(function(x) String(x.Type || \"\").toLowerCase() === \"boxset\");\n      if (box.Id) {\n        var hit = { id: box.Id, name: box.Name };\n        if (cacheKey) _boxSetCache.set(cacheKey, hit);\n        return hit;\n      }\n    } catch (e) {\n      if (!signal.aborted) console.debug(\"getBoxSetForMovie: ancestors fallback:\", e);\n    }\n\n    var movieName = function(() {\n      try { return (window.__jms_lastDisplayItemName || \"\").toString().trim(); }\n      catch { return \"\"; }\n    })();\n\n    var qp = new URLSearchParams();\n    qp.set(\"UserId\", userId);\n    qp.set(\"IncludeItemTypes\", \"BoxSet\");\n    qp.set(\"Recursive\", \"true\");\n    qp.set(\"Limit\", \"60\");\n    qp.set(\"Fields\", \"ChildCount\");\n    if (movieName) qp.set(\"SearchTerm\", movieName);\n\n    var res = makeApiRequest("/Items?${qp.toString()}", { signal });\n    var candidates = res.Items || [];\n\n    if (!candidates.length) {\n      qp.delete(\"SearchTerm\");\n      qp.set(\"Limit\", \"1000\");\n      res = makeApiRequest("/Items?${qp.toString()}", { signal });\n      candidates = res.Items || [];\n    }\n\n    for (var s of (candidates || []).filter(function(x) (x.ChildCount || 1) > 0)) {\n      var childQp = new URLSearchParams();\n      childQp.set(\"UserId\", userId);\n      childQp.set(\"ParentId\", String(s.Id));\n      var children = makeApiRequest("/Items?${childQp.toString()}", { signal });\n      if ((children.Items || []).some(function(x) String(x.Id) === String(movieId))) {\n        var hit = { id: s.Id, name: s.Name };\n        if (cacheKey) _boxSetCache.set(cacheKey, hit);\n        return hit;\n      }\n    }\n\n    if (cacheKey) _boxSetCache.set(cacheKey, null);\n    return null;\n  } catch (e) {\n    console.warn(\"getBoxSetForMovie error:\", e);\n    return null;\n  }\n}\n\nfunction fetchCollectionItems(boxsetId, { signal, limit = 12 } = {}) {\n  try {\n    var userId = (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    if (!userId || !boxsetId) return [];\n\n    var qp = new URLSearchParams();\n    qp.set(\"UserId\", userId);\n    qp.set(\"ParentId\", String(boxsetId));\n    qp.set(\"IncludeItemTypes\", \"Movie\");\n    qp.set(\"Limit\", String(limit));\n    qp.set(\"Fields\", \"Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData\");\n    qp.set(\"SortBy\", \"ProductionYear,SortName\");\n    qp.set(\"SortOrder\", \"Ascending\");\n\n    var r = makeApiRequest("/Items?${qp.toString()}", { signal });\n    return Array.isArray(r.Items) ? r.Items : [];\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"fetchCollectionItems error:\", e);\n    return [];\n  }\n}\n\nfunction renderCollectionHtml({ title = \"\", items = [] } = {}) {\n  if (!items.length) {\n    return "<div class="jmsdm-empty-state" style="color:rgba(255,255,255,.6);font-size:14px;padding:16px;text-align:center;">
      ${config.languageLabels.collectionNotFound || "Coleção não encontrada."}
    </div>";\n  }\n\n  var head = title\n    ? "<div style="color:rgba(255,255,255,.75);font-size:12px;margin-bottom:8px;">${escapeHtml(title)}</div>"\n    : \"\";\n\n  return "
    ${head}
    ${renderMiniCards(items)}
  ";\n}\n\nvar TTL_BOXSET_ITEMS = 2 * 24 * 60 * 60 * 1000;\n\nfunction minimizeItems(items = []) {\n  return (items || []).map(function(x) ({\n    Id: x.Id,\n    Name: x.Name,\n    ProductionYear: x.ProductionYear,\n    CommunityRating: x.CommunityRating,\n    ImageTags: x.ImageTags,\n    PrimaryImageAspectRatio: x.PrimaryImageAspectRatio,\n    UserData: x.UserData,\n  }));\n}\n\nfunction fetchCollectionItemsAll(boxsetId, { signal } = {}) {\n  var userId = (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n  if (!userId || !boxsetId) return [];\n\n  var out = [];\n  var seen = new Set();\n  var start = 0;\n  var PAGE = 200;\n\n  while (true) {\n    var qp = new URLSearchParams();\n    qp.set(\"UserId\", userId);\n    qp.set(\"ParentId\", String(boxsetId));\n    qp.set(\"IncludeItemTypes\", \"Movie\");\n    qp.set(\"Fields\", \"Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating\");\n    qp.set(\"SortBy\", \"ProductionYear,SortName\");\n    qp.set(\"SortOrder\", \"Ascending\");\n    qp.set(\"Limit\", String(PAGE));\n    qp.set(\"StartIndex\", String(start));\n\n    var r = makeApiRequest("/Items?${qp.toString()}", { signal });\n    var items = Array.isArray(r.Items) ? r.Items : [];\n\n    for (var it of items) {\n      var id = it.Id ? String(it.Id) : \"\";\n      if (!id || seen.has(id)) continue;\n      seen.add(id);\n      out.push(it);\n    }\n\n    if (items.length < PAGE) break;\n    start += PAGE;\n  }\n\n  return out;\n}\n\nfunction fetchOtherCollections(currentId, { signal, limit = 12 } = {}) {\n  try {\n    var userId = (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    if (!userId) return [];\n\n    var qp = new URLSearchParams();\n    qp.set(\"UserId\", userId);\n    qp.set(\"IncludeItemTypes\", \"BoxSet\");\n    qp.set(\"Recursive\", \"true\");\n    qp.set(\"Limit\", String(Math.max(limit * 3, 40)));\n    qp.set(\"Fields\", \"Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating\");\n    qp.set(\"SortBy\", \"SortName\");\n    qp.set(\"SortOrder\", \"Ascending\");\n\n    var r = makeApiRequest("/Items?${qp.toString()}", { signal });\n    var items = Array.isArray(r.Items) ? r.Items : [];\n    return items\n      .filter(function(x) x.Id && String(x.Id) !== String(currentId))\n      .slice(0, limit);\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"fetchOtherCollections error:\", e);\n    return [];\n  }\n}\n\nfunction fetchAlbumTracks(albumId, { signal, limit = 300 } = {}) {\n  try {\n    var userId = (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    if (!userId || !albumId) return [];\n\n    var qp = new URLSearchParams();\n    qp.set(\"UserId\", userId);\n    qp.set(\"ParentId\", String(albumId));\n    qp.set(\"IncludeItemTypes\", \"Audio\");\n    qp.set(\"Recursive\", \"true\");\n    qp.set(\"Limit\", String(limit));\n    qp.set(\"Fields\", \"Id,Name,RunTimeTicks,IndexNumber,ImageTags,UserData,AlbumId,AlbumPrimaryImageTag,PrimaryImageTag\");\n    qp.set(\"SortBy\", \"IndexNumber,SortName\");\n    qp.set(\"SortOrder\", \"Ascending\");\n\n    var r = makeApiRequest("/Items?${qp.toString()}", { signal });\n    var items = Array.isArray(r.Items) ? r.Items : [];\n    return items;\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"fetchAlbumTracks error:\", e);\n    return [];\n  }\n}\n\nfunction fetchOtherAlbums(seedItem, { signal, limit = 12 } = {}) {\n  try {\n    var userId = (window.ApiClient.getCurrentUserId.() || window.ApiClient._currentUserId) || \"\";\n    if (!userId) return [];\n\n    var isTrackSeed = String(seedItem.Type || \"\") === \"Audio\";\n    var currentAlbumId =\n      seedItem.Type === \"MusicAlbum\"\n        ? String(seedItem.Id || \"\")\n        : String(seedItem.AlbumId || seedItem.ParentId || \"\");\n\n    var byArtist =\n      safeText(seedItem.AlbumArtist, \"\") ||\n      (Array.isArray(seedItem.Artists) ? safeText(seedItem.Artists[0], \"\") : \"\");\n\n    var artistIdCandidates = [\n      seedItem.AlbumArtistId,\n      seedItem.ArtistId,\n      ...(Array.isArray(seedItem.ArtistIds) ? seedItem.ArtistIds : []),\n      ...(Array.isArray(seedItem.ArtistItems) ? seedItem.ArtistItems.map(function(x) x.Id) : []),\n    ]\n      .map(function(x) String(x || \"\").trim())\n      .filter(Boolean);\n\n    var runQuery = function({ searchTerm = \"\", artistId = \"\", albumArtistId = \"\" } = {}) {\n      var qp = new URLSearchParams();\n      qp.set(\"UserId\", userId);\n      qp.set(\"IncludeItemTypes\", \"MusicAlbum\");\n      qp.set(\"Recursive\", \"true\");\n      qp.set(\"Limit\", String(Math.max(limit * 3, 40)));\n      qp.set(\"Fields\", \"Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating,AlbumArtist,Artists\");\n      qp.set(\"SortBy\", \"DateCreated,SortName\");\n      qp.set(\"SortOrder\", \"Descending\");\n      if (artistId) qp.set(\"ArtistIds\", artistId);\n      if (albumArtistId) qp.set(\"AlbumArtistIds\", albumArtistId);\n      if (searchTerm) qp.set(\"SearchTerm\", searchTerm);\n      var r = makeApiRequest("/Items?${qp.toString()}", { signal });\n      return Array.isArray(r.Items) ? r.Items : [];\n    };\n\n    var items = [];\n\n    if (isTrackSeed && artistIdCandidates.length) {\n      for (var aid of artistIdCandidates) {\n        items = runQuery({ albumArtistId: aid });\n        if (items.length) break;\n      }\n\n      if (!items.length) {\n        for (var aid of artistIdCandidates) {\n          items = runQuery({ artistId: aid });\n          if (items.length) break;\n        }\n      }\n    }\n\n    if (!items.length && byArtist) items = runQuery({ searchTerm: byArtist });\n    if (!items.length && byArtist) items = runQuery({});\n\n    var artistNameSet = new Set(\n      [\n        safeText(seedItem.AlbumArtist, \"\"),\n        ...(Array.isArray(seedItem.Artists) ? seedItem.Artists : []),\n      ]\n        .map(function(x) String(x || \"\").trim().toLocaleLowerCase())\n        .filter(Boolean)\n    );\n\n    if (isTrackSeed && artistNameSet.size) {\n      items = items.filterfunction((it) {\n        var names = [\n          safeText(it.AlbumArtist, \"\"),\n          ...(Array.isArray(it.Artists) ? it.Artists : []),\n        ]\n          .map(function(x) String(x || \"\").trim().toLocaleLowerCase())\n          .filter(Boolean);\n        if (!names.length) return false;\n        return names.some(function(n) artistNameSet.has(n));\n      });\n    }\n\n    var seen = new Set();\n    var out = [];\n    for (var it of items) {\n      var id = it.Id ? String(it.Id) : \"\";\n      if (!id || seen.has(id)) continue;\n      seen.add(id);\n      if (currentAlbumId && id === currentAlbumId) continue;\n      out.push(it);\n      if (out.length >= limit) break;\n    }\n    return out;\n  } catch (e) {\n    if (!signal.aborted) console.warn(\"fetchOtherAlbums error:\", e);\n    return [];\n  }\n}\n\nfunction renderAudioTracksHtml(items = [], { activeTrackId = \"\", fallbackAlbumId = \"\" } = {}) {\n  if (!items.length) {\n    return "<div style="color:rgba(255,255,255,.75);font-size:13px;line-height:1.5;">${config.languageLabels.noTracks || "Nenhuma música encontrada."}</div>";\n  }\n\n  return "
    <div class="jmsdm-episodes">
      ${items.mapfunction((track, i) {
        var num = (track.IndexNumber || (i + 1));
        var trackName = safeText(track.Name, config.languageLabels.track || "Música");
        var trackRuntime = fmtRuntime(track.RunTimeTicks);
        var img = getAudioImageUrlMini(track, { maxWidth: 260, fallbackAlbumId });
        var activeClass = (activeTrackId && String(track.Id) === String(activeTrackId)) ? " active" : "";

        return "\n          <div class=\"jmsdm-ep" + (activeClass) + "\" data-epid=\"" + (track.Id || "") + "\">\n            <div class=\"jmsdm-ep-thumb\">\n              ${\n                img\n                  ? "<img src="${img}" alt="${escapeHtml(trackName)}" loading="lazy" decoding="async">"\n                  : "<div class="jmsdm-skeleton" style="width:100%;height:100%;"></div>"\n              }\n            </div>\n\n            <div class=\"jmsdm-ep-num\">" + (escapeHtml(String(num))) + "</div>\n\n            <div class=\"jmsdm-ep-main\">\n              <div class=\"jmsdm-ep-name\">" + (escapeHtml(trackName)) + "</div>\n              <div class=\"jmsdm-ep-over\">" + (escapeHtml(trackRuntime || "")) + "</div>\n            </div>\n          </div>\n        ";
      }).join("")}
    </div>
  ";\n}\n\nfunction startBoxSetLoad(root, boxsetItem, { signal } = {}) {\n  function(() {\n    try {\n      if (!root || !boxsetItem.Id) return;\n      var itemsHost = root.querySelector(\".jmsdm-boxset-items-host\");\n      var otherHost = root.querySelector(\".jmsdm-boxset-other-host\");\n      if (!itemsHost || !otherHost) return;\n\n      var [items, others] = Promise.all([\n        fetchCollectionItemsAll(boxsetItem.Id, { signal }),\n        fetchOtherCollections(boxsetItem.Id, { signal, limit: 12 }),\n      ]);\n      if (!_open || signal.aborted) return;\n\n      itemsHost.innerHTML = renderMiniCards((items || []).slice(0, 12));\n      otherHost.innerHTML = renderMiniCards(others || []);\n    } catch (e) {\n      if (!signal.aborted) console.warn(\"boxset load error:\", e);\n      try {\n        var itemsHost = root.querySelector.(\".jmsdm-boxset-items-host\");\n        var otherHost = root.querySelector.(\".jmsdm-boxset-other-host\");\n        if (itemsHost) itemsHost.innerHTML = renderMiniCards([]);\n        if (otherHost) otherHost.innerHTML = renderMiniCards([]);\n      } catch {}\n    }\n  })();\n}\n\nfunction startMusicLoad(root, musicItem, { signal } = {}) {\n  function(() {\n    try {\n      if (!root || !musicItem.Id) return;\n      var tracksHost = root.querySelector(\".jmsdm-music-tracks-host\");\n      var albumsHost = root.querySelector(\".jmsdm-music-albums-host\");\n      if (!tracksHost || !albumsHost) return;\n\n      var albumId =\n        musicItem.Type === \"MusicAlbum\"\n          ? musicItem.Id\n          : (musicItem.AlbumId || musicItem.ParentId || null);\n\n      var [tracks, albums] = Promise.all([\n        albumId ? fetchAlbumTracks(albumId, { signal }) : Promise.resolve([]),\n        fetchOtherAlbums(musicItem, { signal, limit: 12 }),\n      ]);\n      if (!_open || signal.aborted) return;\n\n      tracksHost.innerHTML = renderAudioTracksHtml(tracks || [], {\n        activeTrackId: musicItem.Type === \"Audio\" ? musicItem.Id : \"\",\n        fallbackAlbumId: albumId || \"\",\n      });\n      albumsHost.innerHTML = renderMiniCards(albums || []);\n    } catch (e) {\n      if (!signal.aborted) console.warn(\"music load error:\", e);\n      try {\n        var tracksHost = root.querySelector.(\".jmsdm-music-tracks-host\");\n        var albumsHost = root.querySelector.(\".jmsdm-music-albums-host\");\n        if (tracksHost) tracksHost.innerHTML = renderAudioTracksHtml([]);\n        if (albumsHost) albumsHost.innerHTML = renderMiniCards([]);\n      } catch {}\n    }\n  })();\n}\n\nfunction startCollectionLoad(root, movieItem, { signal } = {}) {\n  function(() {\n    try {\n      if (!root || !movieItem.Id) return;\n      var host = root.querySelector(\".jmsdm-collection-host\");\n      if (!host) return;\n\n      var collectionLabel = config.languageLabels.collectionTitle || \"Coleção\";\n      var box = getBoxSetForMovieCached(movieItem.Id, { signal });\n      if (!_open || signal.aborted) return;\n\n      if (!box.id) {\n        host.innerHTML = renderCollectionHtml({ title: \"\", items: [] });\n        return;\n      }\n\n      var cachedItemsRow = CollectionCacheDB.getBoxsetItems(box.id).catchfunction(() null);\n      var cachedOk = cachedItemsRow && cachedItemsRow.items.length && !isStale(cachedItemsRow.updatedAt, TTL_BOXSET_ITEMS);\n\n      if (cachedOk) {\n        var filtered = (cachedItemsRow.items || [])\n          .filter(function(x) x.Id && String(x.Id) !== String(movieItem.Id))\n          .slice(0, 12);\n\n        host.innerHTML = renderCollectionHtml({\n          title: box.name ? "${collectionLabel}: ${box.name}" : collectionLabel,\n          items: filtered\n        });\n\n        CollectionCacheDB.idlefunction(() {\n          try {\n            var liveItems = fetchCollectionItemsAll(box.id, { signal: _bgAbort.signal || null });\n            var minimized = minimizeItems(liveItems);\n            CollectionCacheDB.setBoxsetItems(box.id, minimized);\n\n            var filtered2 = minimized\n              .filter(function(x) x.Id && String(x.Id) !== String(movieItem.Id))\n              .slice(0, 12);\n\n            if (_open && !signal.aborted && root.isConnected) {\n              host.innerHTML = renderCollectionHtml({\n                title: box.name ? "${collectionLabel}: ${box.name}" : collectionLabel,\n                items: filtered2\n              });\n            }\n          } catch {}\n        });\n\n        return;\n      }\n\n      var liveItems = fetchCollectionItemsAll(box.id, { signal });\n      if (!_open || signal.aborted) return;\n\n      var minimized = minimizeItems(liveItems);\n      CollectionCacheDB.setBoxsetItems(box.id, minimized);\n\n      var filtered = minimized\n        .filter(function(x) x.Id && String(x.Id) !== String(movieItem.Id))\n        .slice(0, 12);\n\n      host.innerHTML = renderCollectionHtml({\n        title: box.name ? "${collectionLabel}: ${box.name}" : collectionLabel,\n        items: filtered\n      });\n    } catch (e) {\n      if (!signal.aborted) console.warn(\"collection load error:\", e);\n      try {\n        var host = root.querySelector.(\".jmsdm-collection-host\");\n        if (host) host.innerHTML = renderCollectionHtml({ title: \"\", items: [] });\n      } catch {}\n    }\n  })();\n}\n\nfunction startRecoLoad(root, movieItem, { signal } = {}) {\n  function(() {\n    try {\n      if (!root || !movieItem.Id) return;\n      var wrap = root.querySelector(\".jmsdm-recos-wrap\");\n      if (!wrap) return;\n\n      var LIMIT = 12;\n      var seen = new Set([String(movieItem.Id)]);\n      var picked = [];\n\n      try {\n        var sim = fetchSimilarItems(movieItem.Id, { signal, limit: LIMIT * 2 });\n        if (!_open || signal.aborted) return;\n        picked.push(...uniqById(sim, seen));\n      } catch {}\n\n      if (picked.length < LIMIT) {\n        try {\n          var byG = fetchMoviesByGenres(movieItem.Genres || [], { signal, limit: LIMIT * 2 });\n          if (!_open || signal.aborted) return;\n          picked.push(...uniqById(byG, seen));\n        } catch {}\n      }\n\n      if (picked.length < LIMIT) {\n        try {\n          var byP = fetchMoviesByPeople(movieItem.People || [], { signal, limit: LIMIT * 2 });\n          if (!_open || signal.aborted) return;\n          picked.push(...uniqById(byP, seen));\n        } catch {}\n      }\n\n      var final = picked.slice(0, LIMIT);\n      wrap.innerHTML = renderMiniCards(final);\n    } catch (e) {\n      if (!signal.aborted) console.warn(\"reco load error:\", e);\n    }\n  })();\n}\n\nexport function openDetailsModal({ itemId, serverId = \"\", preferBackdropIndex = \"0\", perPage = 6, originEl } = {}) {\n  if (!itemId) return;\n  var detailsRuntime = getDetailsModalRuntimeConfig();\n  var _originResolved = __resolveOriginEl(originEl || document.activeElement);\n  var _nextOrigin = { el: _originResolved, rect: __getRectSafe(_originResolved) };\n\n  if (_open) {\n    closeDetailsModal();\n    new Promise(function(resolve) setTimeout(resolve, 100));\n  }\n\n  _openOrigin = _nextOrigin;\n  _open = true;\n  _lastFocus = document.activeElement;\n  _abort = new AbortController();\n  _bgAbort = new AbortController();\n  _restore = capturePreviewState();\n  if (_restore) pausePreviewNow(_restore);\n\n  var root = ensureRoot();\n  ensureLocalCommentStyles();\n  lockScroll(true);\n  renderSkeleton(root);\n  wireMiniCardDelegation();\n  try { root.style.visibility = \"hidden\"; root.style.opacity = \"0\"; } catch {}\n  _unbindKeyHandler = wireCloseHandlers(root, closeDetailsModal);\n\n  setTimeoutfunction(() { if (_open) focusFirst(root); }, 50);\n\n  var item = null;\n  try {\n    item = fetchItemDetailsFull(itemId, { signal: _abort.signal });\n  } catch (e) {\n    if (_abort.signal.aborted) return;\n    console.warn(\"openDetailsModal: fetchItemDetailsFull error:\", e);\n  }\n  if (!_open || _abort.signal.aborted) return;\n\n  if (!item) {\n    root.innerHTML = "
      <div class="jmsdm-backdrop" role="dialog" aria-modal="true">
        <div class="jmsdm-card" tabindex="-1">
          <div class="jmsdm-topbar"><button class="jmsdm-close" aria-label="${config.languageLabels.close || "Fechar"}">✕</button></div>
          <div style="padding:20px;color:rgba(255,255,255,.9);">${config.languageLabels.detailsFetchFailed || "Não foi possível carregar os detalhes."}</div>
        </div>
      </div>
    ";\n    wireCloseHandlers(root, closeDetailsModal);\n    try { root.style.visibility = \"visible\"; root.style.opacity = \"1\"; } catch {}\n    __animateInFromOrigin(root);\n    return;\n  }\n\n  var baseItem = item;\n  var seriesItem = null;\n  var isEpisode = baseItem.Type === \"Episode\";\n  if (isEpisode && baseItem.SeriesId) {\n    try {\n      seriesItem = fetchItemDetailsFull(baseItem.SeriesId, { signal: _abort.signal });\n    } catch (e) {\n      if (!_abort.signal.aborted) console.warn(\"openDetailsModal: fetch parent series error:\", e);\n    }\n    if (!_open || _abort.signal.aborted) return;\n  }\n\n  var displayItem = seriesItem || baseItem;\n  var nameBase = safeText(displayItem.Name, config.languageLabels.untitled || \"Sem título\");\n\n  try {\n    window.__jms_lastDisplayItemName = safeText(displayItem.Name, \"\");\n  } catch {}\n\n  var epName = isEpisode ? safeText(baseItem.Name, \"\") : \"\";\n  var name = (isEpisode && epName && epName !== nameBase) ? "${nameBase} — ${epName}" : nameBase;\n\n  var overview = safeText(displayItem.Overview, config.languageLabels.noDescription || \"Sem descrição.\");\n  var year = displayItem.ProductionYear ? String(displayItem.ProductionYear) : \"\";\n  var rating = formatOfficialRatingLabel(displayItem.OfficialRating) || \"\";\n  var community = displayItem.CommunityRating ? String(displayItem.CommunityRating.toFixed.(1) || displayItem.CommunityRating) : \"\";\n  var runtime = fmtRuntime(\n    baseItem.RunTimeTicks ||\n    displayItem.RunTimeTicks ||\n    baseItem.CumulativeRunTimeTicks ||\n    displayItem.CumulativeRunTimeTicks\n  );\n  var genres = Array.isArray(displayItem.Genres) ? displayItem.Genres.slice(0, 6) : [];\n  var typeRaw = safeText(baseItem.Type || displayItem.Type, \"\");\n  var type = localizeItemType(typeRaw);\n\n  var btIndex = String(preferBackdropIndex || \"0\");\n  var btTag =\n    (displayItem.ImageTags.Backdrop.[btIndex]) ||\n    (Array.isArray(displayItem.BackdropImageTags) ? displayItem.BackdropImageTags[Number(btIndex)] : \"\") ||\n    \"\";\n  var backdropUrl = btTag\n    ? withServer("/Items/${encodeURIComponent(displayItem.Id)}/Images/Backdrop/${encodeURIComponent(btIndex)}?tag=${encodeURIComponent(btTag)}&quality=90&maxWidth=1920")\n    : \"\";\n  var heroPrimaryUrl =\n    getHeroPrimaryImageUrl(displayItem, { maxWidth: 1400 }) ||\n    getHeroPrimaryImageUrl(baseItem, { maxWidth: 1400 }) ||\n    \"\";\n  var heroImageUrl = backdropUrl || heroPrimaryUrl;\n\n  var detailsHref = getDetailsUrl(baseItem.Id);\n  var isSeries = baseItem.Type === \"Series\";\n  var seriesId = isSeries\n    ? baseItem.Id\n    : (baseItem.Type === \"Season\"\n        ? baseItem.SeriesId\n        : (isEpisode ? baseItem.SeriesId : null));\n\n  var episodeSeasonId = isEpisode ? (baseItem.SeasonId || baseItem.ParentId || null) : null;\n  var isMovie = baseItem.Type === \"Movie\";\n  var isBoxSet = baseItem.Type === \"BoxSet\";\n  var isMusicAlbum = baseItem.Type === \"MusicAlbum\";\n  var isAudio = baseItem.Type === \"Audio\";\n  var isMusicType = isMusicAlbum || isAudio;\n  var supportsLocalComments =\n    detailsRuntime.showLocalComments &&\n    !!safeText(baseItem.Id || displayItem.Id, \"\");\n  var supportsTmdbReviews =\n    detailsRuntime.showTmdbReviews &&\n    (\n      baseItem.Type === \"Movie\" ||\n      baseItem.Type === \"Series\" ||\n      baseItem.Type === \"Season\" ||\n      baseItem.Type === \"Episode\"\n    );\n  var isFavInitial = !!(baseItem.UserData.IsFavorite || displayItem.UserData.IsFavorite);\n\n  var isFavorite = isFavInitial;\n  var recos = { title: \"\", items: [] };\n  var seasons = [];\n  var selectedSeasonId =\n    baseItem.Type === \"Season\"\n      ? baseItem.Id\n      : (isEpisode ? episodeSeasonId : null);\n\n  if (isSeries && seriesId) {\n    seasons = fetchSeasonsForSeries(seriesId, { signal: _abort.signal });\n    if (!_open || _abort.signal.aborted) return;\n    selectedSeasonId = seasons[0].Id || null;\n  } else if (item.Type === \"Season\" && seriesId) {\n    seasons = fetchSeasonsForSeries(seriesId, { signal: _abort.signal });\n    if (!_open || _abort.signal.aborted) return;\n  }\n\n  var mediaSource =\n    (Array.isArray(baseItem.MediaStreams) && baseItem.MediaStreams.length)\n      ? baseItem\n      : displayItem;\n  var creditSource =\n    (Array.isArray(displayItem.People) && displayItem.People.length)\n      ? displayItem\n      : baseItem;\n  var studioSource =\n    (Array.isArray(displayItem.Studios) && displayItem.Studios.length)\n      ? displayItem\n      : baseItem;\n  var runtimeTicks = Number(\n    baseItem.RunTimeTicks ||\n    displayItem.RunTimeTicks ||\n    baseItem.CumulativeRunTimeTicks ||\n    displayItem.CumulativeRunTimeTicks ||\n    0\n  );\n  var playbackTicks = Number(\n    baseItem.UserData.PlaybackPositionTicks ||\n    displayItem.UserData.PlaybackPositionTicks ||\n    0\n  );\n  var remaining = runtimeTicks > playbackTicks ? fmtRuntime(runtimeTicks - playbackTicks) : \"\";\n  var finishTime = playbackTicks > 0 ? formatFinishTime(runtimeTicks, playbackTicks) : \"\";\n  var communityRatingText = formatCommunityRating(displayItem.CommunityRating || baseItem.CommunityRating);\n  var studioEntries = getStudioEntries(studioSource);\n  var studioNames = studioEntries.mapfunction((studio) studio.name);\n  var primaryStudioEntry = studioEntries[0] || null;\n  var directors = isBoxSet ? [] : getPeopleNames(creditSource, \"Director\", 4);\n  var writers = isBoxSet ? [] : getPeopleNames(creditSource, \"Writer\", 4);\n  var actors = isBoxSet ? [] : getActorNames(creditSource, 8);\n  var artists = uniqTextList(baseItem.Artists || displayItem.Artists || []).slice(0, 8);\n  var albumArtist = safeText(baseItem.AlbumArtist || displayItem.AlbumArtist);\n  var albumName = safeText(baseItem.Album || displayItem.Album);\n  var videoStream = isBoxSet ? null : getPrimaryVideoStream(mediaSource);\n  var videoQuality = getVideoQualityLabel(videoStream);\n  var audioTracks = isBoxSet\n    ? []\n    : getMediaStreamsByType(mediaSource, \"Audio\").map(formatAudioStream).filter(Boolean).slice(0, 4);\n  var subtitleTracks = isBoxSet\n    ? []\n    : getMediaStreamsByType(mediaSource, \"Subtitle\").map(formatSubtitleStream).filter(Boolean).slice(0, 4);\n  var seasonEpisodeText = function(() {\n    if (!isEpisode) return \"\";\n    var seasonNumber = Number(baseItem.ParentIndexNumber || 0);\n    var episodeNumber = Number(baseItem.IndexNumber || 0);\n    var parts = [];\n    if (Number.isFinite(seasonNumber) && seasonNumber > 0) {\n      parts.push("S${String(seasonNumber).padStart(2, "0")}");\n    }\n    if (Number.isFinite(episodeNumber) && episodeNumber > 0) {\n      parts.push("E${String(episodeNumber).padStart(2, "0")}");\n    }\n    return parts.join(\" • \");\n  })();\n  var subtitleLine = [year, runtime].filter(Boolean).join(\" • \");\n  var infoLine = [\n    seasonEpisodeText,\n    isMusicType ? albumArtist : \"\",\n    isMusicType ? albumName : \"\"\n  ].filter(Boolean).join(\" • \");\n  var previewChips = [\n    communityRatingText ? { text: communityRatingText } : null,\n    rating ? { text: rating, accent: true } : null,\n    videoQuality ? { text: videoQuality.split(\" • \").slice(0, 2).join(\" • \") } : null,\n    primaryStudioEntry ? {\n      text: primaryStudioEntry.name,\n      studioId: primaryStudioEntry.id,\n      studioName: primaryStudioEntry.name\n    } : null\n  ].filterfunction((chip) safeText(chip.text)).slice(0, 4);\n  var stats = [\n    { label: label(\"duration\", \"Duração\"), value: runtime },\n    { label: label(\"watchlistPreviewRemaining\", \"Restante\"), value: remaining },\n    { label: label(\"watchlistPreviewFinishAt\", \"Termina às\"), value: finishTime },\n    { label: label(\"watchlistPreviewVideoQuality\", \"Video\"), value: videoQuality || safeText(baseItem.MediaType || displayItem.MediaType) },\n    { label: label(\"director\", \"Diretor\"), value: directors.join(\", \") },\n    { label: label(\"watchlistPreviewStudio\", \"Estúdio\"), value: studioNames.join(\", \") || albumArtist || albumName }\n  ].filterfunction((entry) safeText(entry.value));\n  var mediaFields = isBoxSet\n    ? []\n    : [\n        { label: label(\"watchlistPreviewVideoTrack\", \"Video\"), value: videoQuality },\n        { label: label(\"watchlistPreviewAudioCount\", \"Áudio\"), value: audioTracks.length ? "${audioTracks.length} ${label("watchlistPreviewTrackSuffix", "faixas")}" : \"\" },\n        { label: label(\"watchlistPreviewSubtitleCount\", \"Legendas\"), value: subtitleTracks.length ? "${subtitleTracks.length} ${label("watchlistPreviewTrackSuffix", "faixas")}" : \"\" }\n      ];\n  var creditFields = isBoxSet\n    ? []\n    : [\n        { label: label(\"director\", \"Diretor\"), value: directors.join(\", \") },\n        { label: label(\"watchlistPreviewWriter\", \"Escritor\"), value: writers.join(\", \") },\n        { label: label(\"watchlistPreviewActors\", \"Elenco\"), value: actors.join(\", \") },\n        { label: label(\"watchlistPreviewArtists\", \"Artistas\"), value: artists.join(\", \") },\n        { label: label(\"watchlistPreviewAlbum\", \"Álbum\"), value: albumName },\n        { label: label(\"watchlistPreviewAlbumArtist\", \"Artista do Álbum\"), value: albumArtist }\n      ];\n\n  var episodes = [];\n  if (seriesId) {\n    episodes = fetchEpisodesFor(seriesId, selectedSeasonId, { signal: _abort.signal });\n  }\n  if (!_open || _abort.signal.aborted) return;\n\n  var page = 1;\n  var totalPages = function() Math.max(1, Math.ceil((episodes.length || 0) / perPage));\n  var pageSlice = function() episodes.slice((page - 1) * perPage, (page - 1) * perPage + perPage);\n\n  function wireMiniCardDelegation() {\n  if (root.__minicardDelegated) return;\n  root.__minicardDelegated = true;\n\n  addEventListenerfunction(root, \"click\", (e) {\n    var card = e.target.closest.(\".jmsdm-minicard\");\n    if (!card || !root.contains(card)) return;\n\n    e.preventDefault();\n    e.stopPropagation();\n\n    var id = card.getAttribute(\"data-itemid\");\n    if (!id) return;\n\n    try {\n      openDetailsModal({\n        itemId: id,\n        serverId,\n        preferBackdropIndex,\n        perPage,\n        originEl: card,\n      });\n    } catch (err) {\n      console.warn(\"openDetailsModal from minicard error:\", err);\n    }\n  });\n}\n\nwireMiniCardDelegation();\n\n  function renderEpisodesHtml() {\n    var items = pageSlice();\n    if (!items.length) {\n      return "<div style="color:rgba(255,255,255,.75);font-size:13px;line-height:1.5;">${config.languageLabels.episodeNotFound || "Nenhum episódio encontrado."}</div>";\n    }\n    return "
      <div class="jmsdm-episodes">
        ${items.mapfunction((ep, i) {
          var s = ep.ParentIndexNumber || "";
          var e = ep.IndexNumber || "";
          var num = (s !== "" && e !== "") ? "S" + (s) + " · E" + (e) : String((page - 1) * perPage + i + 1);
          var epName = safeText(ep.Name, config.languageLabels.episode || "Episódio");
          var img = getEpisodeImageUrlMini(ep, { maxWidth: 260 });
          var epOver = safeText(ep.Overview, "");
          return "\n          <div class=\"jmsdm-ep\" data-epid=\"" + (ep.Id) + "\">\n            <div class=\"jmsdm-ep-thumb\">\n              ${\n                img\n                  ? "<img src="${img}" alt="${escapeHtml(epName)}" loading="lazy" decoding="async">"\n                  : "<div class="jmsdm-skeleton" style="width:100%;height:100%;"></div>"\n              }\n            </div>\n\n            <div class=\"jmsdm-ep-main\">\n              <div class=\"jmsdm-ep-name\">" + (num) + " — " + (epName) + "</div>\n              <div class=\"jmsdm-ep-over\">" + (epOver) + "</div>\n            </div>\n          </div>\n        ";
        }).join("")}
      </div>
    ";\n  }\n\n  function renderRightPanelHtml() {\n    if (isMovie) {\n      var similarTitle = safeText(recos.title, config.languageLabels.similarItems || \"Conteúdos Semelhantes\");\n\n      var collectionLabel =\n        config.languageLabels.collectionTitle ||\n        config.languageLabels.collection ||\n        \"Coleção\";\n\n      return "
        <div class="jmsdm-section-title">${similarTitle}</div>
        <div class="jmsdm-epwrap jmsdm-recos-wrap">
          ${
            (recos.items && recos.items.length)
              ? renderMiniCards(recos.items)
              : "\n                <div class=\"jmsdm-skeleton\" style=\"width:55%;height:12px;margin-top:6px;\"></div>\n                <div class=\"jmsdm-skeleton\" style=\"width:100%;height:86px;margin-top:10px;\"></div>\n              "
          }
        </div>

        <div class="jmsdm-section-title" style="margin-top:16px;">
          ${collectionLabel}
        </div>
        <div class="jmsdm-epwrap jmsdm-collection-wrap">
          <div class="jmsdm-collection-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
          </div>
        </div>
      ";\n    }\n\n    if (isBoxSet) {\n      var collectionItemsTitle =\n        config.languageLabels.collectionItemsTitle ||\n        config.languageLabels.collectionTitle ||\n        \"Conteúdo da Coleção\";\n      var otherCollectionsTitle =\n        config.languageLabels.otherCollectionsTitle ||\n        \"Outras Coleções\";\n\n      return "
        <div class="jmsdm-section-title">${collectionItemsTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-boxset-items-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
          </div>
        </div>

        <div class="jmsdm-section-title" style="margin-top:16px;">${otherCollectionsTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-boxset-other-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
          </div>
        </div>
      ";\n    }\n\n    if (isMusicType) {\n      var tracksTitle = isAudio\n        ? (config.languageLabels.albumTracksTitle || \"Músicas no Álbum\")\n        : (config.languageLabels.tracksTitle || \"Músicas\");\n      var otherAlbumsTitle =\n        isAudio\n          ? (config.languageLabels.artistAlbumsTitle || \"Álbuns do Artista\")\n          : (config.languageLabels.otherAlbumsTitle || \"Outros Álbuns\");\n\n      return "
        <div class="jmsdm-section-title">${tracksTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-music-tracks-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:68px;margin-top:10px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:68px;margin-top:8px;"></div>
          </div>
        </div>

        <div class="jmsdm-section-title" style="margin-top:16px;">${otherAlbumsTitle}</div>
        <div class="jmsdm-epwrap">
          <div class="jmsdm-music-albums-host">
            <div class="jmsdm-skeleton" style="width:55%;height:12px;margin-top:6px;"></div>
            <div class="jmsdm-skeleton" style="width:100%;height:86px;margin-top:10px;"></div>
          </div>
        </div>
      ";\n    }\n\n    var showSeasonUi = seasons.length > 0;\n    var seasonLabel = config.languageLabels.season || \"Temporada\";\n\n    return "
      <div class="jmsdm-section-title">${seriesId ? (config.languageLabels.episodesTitle || "Episódios") : (config.languageLabels.infoTitle || "Informação")}</div>

      ${showSeasonUi ? "\n        <div class=\"jmsdm-season-tabs\">\n          ${seasons.map(function(s) {\n            var n = safeText(s.Name, "${seasonLabel} ${s.IndexNumber || ""}".trim());\n            var isActive = String(s.Id) === String(selectedSeasonId) ? \"active\" : \"\";\n            return "<button class="jmsdm-season-tab ${isActive}" data-season-id="${s.Id}">${n}</button>";\n          }).join(\"\")}\n        </div>\n\n        <div class=\"jmsdm-toolbar\" style=\"justify-content: flex-end;\">\n          <div class=\"jmsdm-pager\">\n            <button class=\"jmsdm-pagebtn jmsdm-prev\" " + (page <= 1 ? "disabled" : "") + ">" + (config.languageLabels.prevPage || "Anterior") + "</button>\n            <span class=\"jmsdm-pagelabel\">" + (page) + " / " + (totalPages()) + "</span>\n            <button class=\"jmsdm-pagebtn jmsdm-next\" " + (page >= totalPages() ? "disabled" : "") + ">" + (config.languageLabels.nextPage || "Próximo") + "</button>\n          </div>\n        </div>\n      " : (seriesId ? "\n        <div class=\"jmsdm-toolbar\" style=\"justify-content: flex-end;\">\n          <div class=\"jmsdm-pager\">\n            <button class=\"jmsdm-pagebtn jmsdm-prev\" " + (page <= 1 ? "disabled" : "") + ">" + (config.languageLabels.prevPage || "Anterior") + "</button>\n            <span class=\"jmsdm-pagelabel\">" + (page) + " / " + (totalPages()) + "</span>\n            <button class=\"jmsdm-pagebtn jmsdm-next\" " + (page >= totalPages() ? "disabled" : "") + ">" + (config.languageLabels.nextPage || "Próximo") + "</button>\n          </div>\n        </div>\n      " : "")}

      <div class="jmsdm-epwrap">
        ${renderEpisodesHtml()}
      </div>
    ";\n  }\n\n  root.innerHTML = "
    <div class="jmsdm-backdrop" role="dialog" aria-modal="true" aria-label="${name}">
      <div class="jmsdm-card" tabindex="-1">
        <div class="jmsdm-content">
          <div class="jmsdm-hero">
            ${heroImageUrl ? "<img src=\"" + (heroImageUrl) + "\" alt=\"\">" : ""}
            <div class="jmsdm-poster-container">
               ${primaryImageUrl ? "<img src=\"" + (primaryImageUrl) + "\" alt=\"\">" : ""}
            </div>
            <div class="jmsdm-topbar">
              <button class="jmsdm-close" aria-label="${labels.kapat || "Fechar"}">✕</button>
            </div>

            <div class="jmsdm-heroTitleWrap" aria-hidden="true">
              <div class="jmsdm-heroTitle">${escapeHtml(name)}</div>
            </div>
          </div>

          <div class="jmsdm-body">
            <div class="jmsdm-left">
              <div class="jmsdm-preview-shell">
                <div class="jmsdm-preview-hero">
                  <div class="jmsdm-preview-hero-inner">
                    <div class="jmsdm-preview-head">
                      <div class="jmsdm-preview-kicker">${escapeHtml(type || safeText(baseItem.Type, ""))}</div>
                      <h2 class="jmsdm-preview-title">${escapeHtml(name)}</h2>
                      ${subtitleLine ? "<div class=\"jmsdm-preview-subtitle\">" + (escapeHtml(subtitleLine)) + "</div>" : ""}
                      ${infoLine ? "<div class=\"jmsdm-preview-subtitle\">" + (escapeHtml(infoLine)) + "</div>" : ""}
                      ${renderPreviewChips(previewChips)}
                    </div>
                  </div>
                </div>

                <div class="jmsdm-preview-body">
                  <div class="jmsdm-overview">${overview}</div>
                  
                  <div class="jmsdm-actions">
                    <button class="jmsdm-btn primary jmsdm-play">
                      ${icon("M8 5v14l11-7z")} ${labels.playNowLabel || "ASSISTIR AGORA"}
                    </button>
                    <button class="jmsdm-btn jmsdm-trailer-btn">
                      ${icon("M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-10 14.5v-9l6 4.5-6 4.5z")} ${labels.playTrailer || "Assistir Trailer"}
                    </button>
                    <button class="jmsdm-btn jmsdm-openpage">
                      ${icon("M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z")} ${labels.goToPageLabel || "Ver Detalhes"}
                    </button>
                    <button class="jmsdm-btn jmsdm-fav" aria-pressed="${isFavorite ? "true" : "false"}">
                      ${icon(isFavorite ? "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" : "M12.1 18.55l-.1.1-.11-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z")}
                      ${getWatchlistButtonText(baseItem, isFavorite)}
                    </button>
                  </div>

                  <div class="jmsdm-metadata-section">
                    ${renderPreviewStats(stats)}
                    ${renderPreviewFieldSection(labels.watchlistPreviewMediaSection || "Informações da Mídia", mediaFields)}
                    ${renderPreviewListSection(labels.watchlistPreviewAudioTracks || "Áudio em Português", audioTracks)}
                    ${renderPreviewListSection(labels.watchlistPreviewSubtitleTracks || "Legendas", subtitleTracks)}
                    ${renderPreviewFieldSection(labels.watchlistPreviewCredits || "Créditos", creditFields)}
                    ${renderPreviewTagSection(labels.genre || "Gênero", genres)}
                    ${renderPreviewStudioSection(labels.watchlistPreviewStudios || "Estúdios", studioEntries)}
                  </div>
                </div>
              </div>

              ${supportsLocalComments ? "<div class=\"jmsdm-local-comments\" style=\"margin-top:18px;\"></div>" : ""}
              ${supportsTmdbReviews ? "<div class=\"jmsdm-tmdb-reviews\" style=\"margin-top:18px;\"></div>" : ""}
            </div>

            <div class="jmsdm-right">
              ${renderRightPanelHtml()}
            </div>
          </div>
        </div>
      </div>
    </div>
  ";\n  _unbindKeyHandler = wireCloseHandlers(root, closeDetailsModal);\n  try { root.style.visibility = \"visible\"; root.style.opacity = \"1\"; } catch {}\n\n  __animateInFromOrigin(root);\n\n  if (isMovie) {\n    startRecoLoad(root, baseItem, { signal: _abort.signal });\n    startCollectionLoad(root, baseItem, { signal: _abort.signal });\n  } else if (isBoxSet) {\n    startBoxSetLoad(root, baseItem, { signal: _abort.signal });\n  } else if (isMusicType) {\n    startMusicLoad(root, baseItem, { signal: _abort.signal });\n  }\n\n  wireOverviewToggle(root);\n  // startHeroTrailer(root, displayItem, { signal: _abort.signal }).catchfunction(() {}); // Desativado auto-play industrial\n  if (supportsLocalComments) {\n    loadLocalCommentsInto(root, baseItem, { signal: _abort.signal });\n  }\n  if (supportsTmdbReviews) {\n    loadTmdbReviewsInto(root, displayItem, { signal: _abort.signal });\n  }\n\n  var playBtn = root.querySelector(\".jmsdm-play\");\n  var initialResumeTicks = getResumeTicksFromItem(baseItem);\n  setPlayButtonLabel(playBtn, initialResumeTicks > 0);\n\n  if (\n    initialResumeTicks <= 0 &&\n    (baseItem.Type === \"Series\" || baseItem.Type === \"Season\")\n  ) {\n    getResumeTicksForContainer(baseItem.Id, { signal: _abort.signal })\n      .thenfunction((t) {\n        if (!_open || _abort.signal.aborted) return;\n        setPlayButtonLabel(playBtn, t > 0);\n      })\n      .catchfunction(() {});\n  }\n\n  var openBtn = root.querySelector(\".jmsdm-openpage\");\n  var favBtn  = root.querySelector(\".jmsdm-fav\");\n  var watchlistBtn = root.querySelector(\".jmsdm-watchlist-open\");\n\n  var updateFavUi = function() {\n    if (!favBtn) return;\n    favBtn.setAttribute(\"aria-pressed\", isFavorite ? \"true\" : \"false\");\n    favBtn.innerHTML = "
      ${icon(isFavorite ? "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" : "M12.1 18.55l-.1.1-.11-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z")}
      ${getWatchlistButtonText(baseItem, isFavorite)}
    ";\n    favBtn.classList.toggle(\"active\", !!isFavorite);\n  };\n\n  updateFavUi();\n\n  var playHandler = function(e) {\n    e.preventDefault();\n    e.stopPropagation();\n    try {\n      playBtn.disabled = true;\n      var started = playNow(baseItem.Id);\n      if (!started) return;\n      closeDetailsModal();\n      notifyDetailsModalPlay(baseItem.Id);\n    } catch (err) {\n      console.error(\"Modal play error:\", err);\n      window.showMessage.(config.languageLabels.playStartFailed || \"Não foi possível iniciar a reprodução\", \"error\");\n    } finally {\n      playBtn.disabled = false;\n    }\n  };\n\n  var openHandler = function(e) {\n    e.preventDefault();\n    e.stopPropagation();\n    try {\n      window.location.hash = String(detailsHref || \"\").replace(/^#/, \"\");\n      closeDetailsModal();\n    } catch {\n      window.location.href = detailsHref;\n    }\n  };\n\n  var trailerBtn = root.querySelector(\".jmsdm-trailer-btn\");\n\n  var trailerHandler = function(e) {\n    e.preventDefault();\n    e.stopPropagation();\n    try {\n      if (trailerBtn) trailerBtn.disabled = true;\n      startHeroTrailer(root, displayItem, { signal: _abort.signal });\n    } catch (err) {\n      console.error(\"Trailer play error:\", err);\n      window.showMessage.(\"Não foi possível carregar o trailer.\", \"error\");\n    } finally {\n      if (trailerBtn) trailerBtn.disabled = false;\n    }\n  };\n\n  addEventListener(playBtn, \"click\", playHandler);\n  if (trailerBtn) addEventListener(trailerBtn, \"click\", trailerHandler);\n  addEventListener(openBtn, \"click\", openHandler);\n  if (watchlistBtn) {\n    addEventListenerfunction(watchlistBtn, \"click\", (e) {\n      e.preventDefault();\n      e.stopPropagation();\n      stopHeroMedia(root);\n      openWatchlistModal({\n        initialTab: getWatchlistTabKey(baseItem),\n        itemId: baseItem.Id,\n        item: baseItem\n      });\n    });\n  }\n\n  addEventListenerfunction(root, \"click\", (e) {\n    var studioBtn = e.target.closest.(\".jmsdm-preview-tag-button[data-jmsdm-studio-id]\");\n    if (!studioBtn || !root.contains(studioBtn)) return;\n\n    e.preventDefault();\n    e.stopPropagation();\n\n    if (!setStudioHubLoadingState(studioBtn, true)) return;\n\n    var studioId = safeText(studioBtn.getAttribute(\"data-jmsdm-studio-id\"));\n    var studioName = safeText(studioBtn.getAttribute(\"data-jmsdm-studio-name\"));\n    if (!studioId) {\n      setStudioHubLoadingState(studioBtn, false);\n      return;\n    }\n\n    var copied = copyTextToClipboard(studioId);\n    if (copied) {\n      studioBtn.classList.add(\"is-copied\");\n      clearTimeout(studioBtn.__copiedTimer);\n      studioBtn.__copiedTimer = setTimeoutfunction(() {\n        studioBtn.classList.remove(\"is-copied\");\n        studioBtn.__copiedTimer = 0;\n      }, 1400);\n    } else {\n      var message = studioName\n        ? "${studioName}: ${label("watchlistPreviewStudioCopyFailed", "Não foi possível copiar o ID do estúdio.")}"\n        : label(\"watchlistPreviewStudioCopyFailed\", \"Não foi possível copiar o ID do estúdio.\");\n      notifyStudioHubResult(message, \"error\", \"clipboard\", 2400);\n    }\n\n    void function(() {\n      try {\n        var autoAddResult = maybeAutoEnsureStudioHub(studioId, studioName);\n        if (autoAddResult.pending) return;\n\n        if (autoAddResult.attempted && autoAddResult.added === false && autoAddResult.existing !== true) {\n          var message = studioName\n            ? "${studioName}: ${safeText(autoAddResult.error.message, label("watchlistPreviewStudioAutoAddFailed", "A coleção não pôde ser adicionada automaticamente."))}"\n            : safeText(autoAddResult.error.message, label(\"watchlistPreviewStudioAutoAddFailed\", \"A coleção não pôde ser adicionada automaticamente.\"));\n          notifyStudioHubResult(message, \"error\", \"triangle-exclamation\", 3200);\n          return;\n        }\n\n        var logoResult = maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, {\n          entries: autoAddResult.entries\n        });\n\n        if (autoAddResult.added && logoResult.uploaded) {\n          var message = studioName\n            ? "${studioName}: ${label("watchlistPreviewStudioAutoAdded", "Salvo automaticamente na lista de coleções.")} ${label("watchlistPreviewStudioTmdbLogoSaved", "O logo do TMDb também foi salvo automaticamente.")}"\n            : "${label("watchlistPreviewStudioAutoAdded", "Salvo automaticamente na lista de coleções.")} ${label("watchlistPreviewStudioTmdbLogoSaved", "O logo do TMDb também foi salvo automaticamente.")}";\n          notifyStudioHubResult(message, \"success\", \"building\", 3000);\n          return;\n        }\n\n        if (autoAddResult.existing && logoResult.uploaded) {\n          var message = studioName\n            ? "${studioName}: ${label("manualCollectionDuplicate", "Esta coleção já está adicionada.")} ${label("watchlistPreviewStudioTmdbLogoSavedSingle", "O logo do TMDb foi salvo automaticamente.")}"\n            : "${label("manualCollectionDuplicate", "Esta coleção já está adicionada.")} ${label("watchlistPreviewStudioTmdbLogoSavedSingle", "O logo do TMDb foi salvo automaticamente.")}";\n          notifyStudioHubResult(message, \"success\", \"building\", 3000);\n          return;\n        }\n\n        if (autoAddResult.added) {\n          var message = studioName\n            ? "${studioName}: ${label("watchlistPreviewStudioAutoAdded", "Salvo automaticamente na lista de coleções.")}"\n            : label(\"watchlistPreviewStudioAutoAdded\", \"Salvo automaticamente na lista de coleções.\");\n          notifyStudioHubResult(message, \"success\", \"building\", 2600);\n          return;\n        }\n\n        if (autoAddResult.existing) {\n          var message = studioName\n            ? "${studioName}: ${label("manualCollectionDuplicate", "Esta coleção já está adicionada.")}"\n            : label(\"manualCollectionDuplicate\", \"Esta coleção já está adicionada.\");\n          notifyStudioHubResult(message, \"success\", \"building\", 2600);\n          return;\n        }\n\n        if (logoResult.uploaded) {\n          var message = studioName\n            ? "${studioName}: ${label("watchlistPreviewStudioTmdbLogoSavedSingle", "O logo do TMDb foi salvo automaticamente.")}"\n            : label(\"watchlistPreviewStudioTmdbLogoSavedSingle\", \"O logo do TMDb foi salvo automaticamente.\");\n          notifyStudioHubResult(message, \"success\", \"image\", 2600);\n        }\n      } finally {\n        setStudioHubLoadingState(studioBtn, false);\n      }\n    })();\n\n  });\n\n  addEventListenerfunction(root, \"keydown\", (e) {\n    if (e.key !== \"Enter\" && e.key !== \" \" && e.key !== \"Spacebar\") return;\n\n    var studioChip = e.target.closest.(\".jmsdm-preview-chip.jmsdm-preview-tag-button[data-jmsdm-studio-id]\");\n    if (!studioChip || !root.contains(studioChip)) return;\n\n    e.preventDefault();\n    e.stopPropagation();\n    studioChip.click();\n  });\n\n  if (favBtn) {\n    addEventListenerfunction(favBtn, \"click\", (e) {\n      e.preventDefault();\n      e.stopPropagation();\n      try {\n        favBtn.disabled = true;\n        var next = !isFavorite;\n        var ok = updateFavoriteStatus(baseItem.Id, next, { item: baseItem });\n        if (ok) {\n          isFavorite = next;\n          try {\n            if (baseItem.UserData) baseItem.UserData.IsFavorite = isFavorite;\n            if (displayItem.UserData) displayItem.UserData.IsFavorite = isFavorite;\n          } catch {}\n          updateFavUi();\n          window.showMessage.(getWatchlistToast(baseItem, isFavorite), \"success\");\n        } else {\n          window.showMessage.(config.languageLabels.favoriteError || \"Falha na operação da lista\", \"error\");\n        }\n      } catch (err) {\n        console.warn(\"fav click error:\", err);\n        window.showMessage.(config.languageLabels.favoriteError || \"Falha na operação da lista\", \"error\");\n      } finally {\n        try { favBtn.disabled = false; } catch {}\n      }\n    });\n  }\n\n  function wireEpisodeClicks() {\n    if (root.__episodeDelegated) return;\n    root.__episodeDelegated = true;\n\n    addEventListenerfunction(root, \"click\", (e) {\n      var el = e.target.closest.(\".jmsdm-ep\");\n      if (!el || !root.contains(el)) return;\n\n      e.preventDefault();\n      e.stopPropagation();\n\n      var epId = el.getAttribute(\"data-epid\");\n      if (!epId) return;\n      try {\n        var started = playNow(epId);\n        if (!started) return;\n        closeDetailsModal();\n        notifyDetailsModalPlay(epId);\n      } catch (err) {\n        console.error(\"Episode play error:\", err);\n        window.showMessage.(config.languageLabels.episodePlayFailed || \"Não foi possível reproduzir o episódio\", \"error\");\n      }\n    });\n  }\n\n  wireEpisodeClicks();\n\n  function wireMiniCardClicks() {\n    root.querySelectorAll(\".jmsdm-minicard\").forEach(function((el) {\n      var clickHandler = function(e) {\n        e.preventDefault();\n        e.stopPropagation();\n        var id = el.getAttribute(\"data-itemid\");\n        if (!id) return;\n        try {\n          openDetailsModal({ itemId: id, serverId, preferBackdropIndex, perPage });\n        } catch (err) {\n          console.warn(\"openDetailsModal from minicard error:\", err);\n        }\n      };\n      addEventListener(el, \"click\", clickHandler);\n    });\n  }\n\n  function rerenderRight() {\n    var right = root.querySelector(\".jmsdm-right\");\n    if (!right) return;\n    var currentScroll = right.scrollTop;\n\n    right.innerHTML = renderRightPanelHtml();\n    if (isMovie || isBoxSet || isMusicType) {\n      wireMiniCardClicks();\n      right.scrollTop = currentScroll;\n      return;\n    }\n\n    var prevBtn = right.querySelector(\".jmsdm-prev\");\n    var nextBtn = right.querySelector(\".jmsdm-next\");\n\n    if (prevBtn) {\n      addEventListenerfunction(prevBtn, \"click\", (e) {\n        e.preventDefault();\n        e.stopPropagation();\n        if (page > 1) { page--; rerenderRight(); }\n      });\n    }\n\n    if (nextBtn) {\n      addEventListenerfunction(nextBtn, \"click\", (e) {\n        e.preventDefault();\n        e.stopPropagation();\n        if (page < totalPages()) { page++; rerenderRight(); }\n      });\n    }\n\n    var seasonTabs = right.querySelectorAll(\".jmsdm-season-tab\");\n    seasonTabs.forEach(function(function(tab) {\n      addEventListener(tab, \"click\", (e) {\n        var v = tab.getAttribute(\"data-season-id\");\n        if (!v || !seriesId) return;\n        selectedSeasonId = v;\n        page = 1;\n        try {\n          right.innerHTML = "<div class="jmsdm-skeleton" style="width:40%;height:12px;margin-top:6px;"></div>`;
          episodes = fetchEpisodesFor(seriesId, selectedSeasonId, { signal: _abort.signal });
          if (!_open || _abort.signal.aborted) return;
          rerenderRight();
        } catch (err) {
          if (_abort.signal.aborted) return;
          episodes = [];
          rerenderRight();
        }
      });
    });

    wireEpisodeClicks();
    right.scrollTop = currentScroll;
  }

  if (isMovie) wireMiniCardClicks();

  var initialPrev = root.querySelector(".jmsdm-prev");
  var initialNext = root.querySelector(".jmsdm-next");
  var initialSelect = root.querySelector(".jmsdm-select");

  if (initialPrev) {
    addEventListenerfunction(initialPrev, "click", (e) {
      e.preventDefault();
      e.stopPropagation();
      if (page > 1) { page--; rerenderRight(); }
    });
  }

  if (initialNext) {
    addEventListenerfunction(initialNext, "click", (e) {
      e.preventDefault();
      e.stopPropagation();
      if (page < totalPages()) { page++; rerenderRight(); }
    });
  }

  if (initialSelect) {
    addEventListenerfunction(initialSelect, "change", (e) {
      var v = e.target.value || "";
      if (!v || !seriesId) return;
      selectedSeasonId = v;
      page = 1;
      try {
        episodes = fetchEpisodesFor(seriesId, selectedSeasonId, { signal: _abort.signal });
        if (!_open || _abort.signal.aborted) return;
        rerenderRight();
      } catch (err) {
        if (_abort.signal.aborted) return;
        episodes = [];
        rerenderRight();
      }
    });
  }

  focusFirst(root);
  window.__lastModalItemId = itemId;
}
