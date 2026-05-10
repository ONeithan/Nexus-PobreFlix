import { getAdminTargetProfile, getConfig, getDeviceProfileAuto, normalizeManagedCardTitleDisplayMode, normalizeManagedHomeSectionOrder, normalizeSettingsHotkey, publishAdminSnapshotIfForced, SETTINGS_HOTKEY_DEFAULT } from "../config.js";
import { updateConfig } from "../configPersistence.js";
import { loadCSS } from "../playerStyles.js";
import { updateSlidePosition } from '../positionUtils.js';
import { createCheckbox, createImageTypeSelect, bindCheckboxKontrol, bindTersCheckboxKontrol } from "./shared.js";
import { updateHeaderUserAvatar, updateAvatarStyles, clearAvatarCache } from "../userAvatar.js";
import { showNotification } from "../player/ui/notification.js";
import { updateJmsPluginConfig } from "../jmsPluginConfig.js";
import { closeDetailsModalIfLoaded } from "../detailsModalLoader.js";
import { saveStudioHubVisibility } from "../studioHubsShared.js";

var _intOr = function(v, def) {
  var n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
var _floatOr = function(v, def) {
  var n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};
var _clamp = function(n, min, max) Math.max(min, Math.min(max, n));
var _DEFAULT_IDLE_MS      = 45000;
var _DEFAULT_UNFOCUS_MS   = 15000;
var _DEFAULT_OFFSCREEN_MS = 10000;
var _MIN_MIN = 0.1;
var _MAX_MIN = 1000;

var __isAdminCached_apply = null;

function flushManagedStorageSnapshot() {
  var bridge = window.__JMS_MANAGED_STORAGE__;
  if (!bridge || typeof bridge.flush !== "function") return;
  bridge.flush();
}

function getJfRootFromLocation_apply() {
  try {
    var baseHref = document.querySelector("base[href]").getAttribute("href");
    if (baseHref) {
      var url = new URL(baseHref, window.location.href);
      return String(url.pathname || "")
        .replace(/\/web\/?$/i, "")
        .replace(/\/+$/, "");
    }
  } catch {}

  var path = String(window.location.pathname || "/");
  var match = path.match(/^(.*?)(?:\/web(?:\/|$).*)$/i);
  return match.[1] ? match[1].replace(/\/+$/, "") : "";
}

function getEmbyTokenSafe_apply() {
  try {
    return window.ApiClient.accessToken.() || window.ApiClient._accessToken || "";
  } catch {
    return "";
  }
}

function readBooleanish_apply(value) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function readAdminFlagFromPolicy_apply(policy) {
  if (!policy || typeof policy !== "object") return null;

  var candidates = [policy.IsAdministrator, policy.IsAdmin, policy.IsAdminUser];
  for (var candidate of candidates) {
    var normalized = readBooleanish_apply(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
}

function readAdminFlagFromUser_apply(user) {
  if (!user || typeof user !== "object") return null;

  var policyFlag = readAdminFlagFromPolicy_apply(user.Policy || user.UserPolicy);
  if (policyFlag !== null) return policyFlag;

  var candidates = [user.IsAdministrator, user.isAdministrator, user.IsAdmin, user.isAdmin];
  for (var candidate of candidates) {
    var normalized = readBooleanish_apply(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
}

function resolveLiveAdminFlag_apply() {
  var liveCandidates = [];

  try {
    var sessionInfo = typeof getSessionInfo === "function" ? getSessionInfo() : null;
    if (sessionInfo.User) liveCandidates.push(sessionInfo.User);
    if (sessionInfo.user) liveCandidates.push(sessionInfo.user);
    if (sessionInfo) liveCandidates.push(sessionInfo);
  } catch {}

  try {
    if (window.ApiClient._currentUser) {
      liveCandidates.push(window.ApiClient._currentUser);
    }
  } catch {}

  for (var candidate of liveCandidates) {
    var flag = readAdminFlagFromUser_apply(candidate);
    if (flag !== null) return flag;
  }

  try {
    var currentUser = window.ApiClient.getCurrentUser.();
    var currentFlag = readAdminFlagFromUser_apply(currentUser);
    if (currentFlag !== null) return currentFlag;
  } catch {}

  try {
    var cachedFlag = readBooleanish_apply(localStorage.getItem("currentUserIsAdmin"));
    if (cachedFlag !== null) return cachedFlag;
  } catch {}

  return null;
}

function buildAdminProbeHeaders_apply(token) {
  var headers = { Accept: "application/json" };
  if (token) headers["X-Emby-Token"] = token;

  try {
    var authHeader = String(
      (typeof getAuthHeader === "function" ? getAuthHeader() : "") || ""
    ).trim();
    if (authHeader) headers.Authorization = authHeader;
  } catch {}

  return headers;
}

function isAdminUser_apply() {
  if (__isAdminCached_apply !== null) return __isAdminCached_apply;

  try {
    var liveAdmin = resolveLiveAdminFlag_apply();
    if (liveAdmin === true) return (__isAdminCached_apply = true);

    var token = getEmbyTokenSafe_apply();
    if (token) {
      var jfRoot = getJfRootFromLocation_apply();
      var r = fetch((jfRoot) + "/Users/Me", {
        cache: "no-store",
        headers: buildAdminProbeHeaders_apply(token)
      });

      if (r.ok) {
        var me = r.json();
        var fetchedAdmin = readAdminFlagFromUser_apply(me);
        if (fetchedAdmin !== null) {
          return (__isAdminCached_apply = fetchedAdmin);
        }
      }
    }

    if (liveAdmin !== null) return (__isAdminCached_apply = liveAdmin);
    return (__isAdminCached_apply = false);
  } catch {
    return (__isAdminCached_apply = false);
  }
}

function getCurrentUserId_apply() {
  try {
    var user = window.ApiClient.getCurrentUser.();
    return String(user.Id || "").trim();
  } catch {
    return "";
  }
}

function updateCastModuleSettings_apply(patch = {}) {
  var token = getEmbyTokenSafe_apply();
  var userId = getCurrentUserId_apply();
  var headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;

  var res = fetch("/Plugins/NexusPobreFlix/cast/settings", {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(patch || {})
  });

  if (!res.ok) {
    var msg = "Cast settings HTTP " + (res.status);
    try {
      var raw = res.text();
      if (raw) msg = raw;
    } catch {}
    throw new Error(msg);
  }

  return res.json().catchfunction(() ({}));
}

function pick(obj, keys) {
  var out = {};
  keys.forEach(function(k) { if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; });
  return out;
}

var USER_ONLY_KEYS = [
  "createAvatar",
  "avatarWidth",
  "avatarHeight",
  "avatarFontSize",
  "avatarTextShadow",
  "avatarColorMethod",
  "avatarSolidColor",
  "avatarGradient",
  "avatarFontFamily",
  "avatarStyle",
  "dicebearStyle",
  "dicebearBackgroundColor",
  "dicebearRadius",
  "avatarScale",
  "dicebearBackgroundEnabled",
  "dicebearPosition",
  "autoRefreshAvatar",
  "avatarRefreshTime",
  "randomDicebearAvatar",
  "dicebearParams",
  "playerTheme",
  "settingsHotkey"
];

  export function applySettings(reload = false) {
    var cfgGuard = getConfig();
        var isAdmin = true;
    if (cfgGuard.forceGlobalUserSettings) {
      isAdmin = isAdminUser_apply();
    }
        var form = document.querySelector('#settings-modal form');
        if (!form) return;
        var formData = new FormData(form);
        var hasNamedControl = function(name) {
          try {
            return !!form.querySelector("[name=\"" + (name) + "\"]");
          } catch {
            return false;
          }
        };
        var hasCastPolicyFields =
          hasNamedControl('enableCastModule') ||
          hasNamedControl('allowSharedCastViewerForUsers');
        var isRealAdmin = hasCastPolicyFields
          ? isAdminUser_apply()
          : false;
        var config = getConfig();
        var oldTheme = getConfig().playerTheme;
        var oldPlayerStyle = getConfig().playerStyle;
        var useGlobalStudioHubsVisibility = cfgGuard.forceGlobalUserSettings === true;
        var studioHubsVisibilityProfile =
          (useGlobalStudioHubsVisibility && cfgGuard.currentUserIsAdmin) ? getAdminTargetProfile() : getDeviceProfileAuto();
        var studioHubsOrderValue = function(() {
          var raw = formData.get('studioHubsOrder');
          if (!raw) return [];
          try {
            var arr = JSON.parse(raw);
            return Array.isArray(arr)
              ? arr.map(function(x) String(x || '').trim()).filter(Boolean)
              : [];
          } catch {
            return [];
          }
        })();
        var studioHubsHiddenValue = function(() {
          var raw = formData.get('studioHubsHidden');
          if (!raw) return [];
          try {
            var arr = JSON.parse(raw);
            return Array.isArray(arr)
              ? arr.map(function(x) String(x || '').trim()).filter(Boolean)
              : [];
          } catch {
            return [];
          }
        })();
        var managedHomeSectionOrderValue = function(() {
          var raw = formData.get('managedHomeSectionOrder');
          if (!raw) return normalizeManagedHomeSectionOrder(config.managedHomeSectionOrder);
          try {
            return normalizeManagedHomeSectionOrder(JSON.parse(raw));
          } catch {
            return normalizeManagedHomeSectionOrder(config.managedHomeSectionOrder);
          }
        })();
        var sapEnabled = formData.get('sapEnabled') === 'on';
        var sapBlurMin = _clamp(
          _floatOr(formData.get('sapBlurMs'), _DEFAULT_UNFOCUS_MS) / 60000,
          0,
          _MAX_MIN
        );

        var sapHiddenMin = _clamp(
          _floatOr(formData.get('sapHiddenMs'), _DEFAULT_OFFSCREEN_MS) / 60000,
          0,
          _MAX_MIN
        );
        var sapIdleMin = _clamp(_floatOr(formData.get('sapIdleMinutes'), _DEFAULT_IDLE_MS/60000), _MIN_MIN, _MAX_MIN);
        var sapUseIdle = formData.get('sapUseIdleDetection') === 'on';
        var sapRespect = formData.get('sapRespectPiP') === 'on';
        var sapIgnoreShort = _intOr(formData.get('sapIgnoreShortUnderSec'), 300);
        var boolFromFd = function(name, fallback) {
          var control = form.querySelector("[name=\"" + (name) + "\"]");
          if (control && control.type === 'checkbox') {
            return control.checked === true;
          }
          return formData.has(name) ? (formData.get(name) === 'on') : (fallback || false);
        };
        var enableCastModule = boolFromFd(
          'enableCastModule',
          config.enableCastModule !== false
        );
        var showCast = enableCastModule && formData.get('showCast') === 'on';
        var allowSharedCastViewerForUsers = enableCastModule && boolFromFd(
          'allowSharedCastViewerForUsers',
          config.allowSharedCastViewerForUsers === true
        );
        var pauseOverlayMinDurMin =
            _clamp(_floatOr(formData.get('pauseOverlayMinVideoMinutes'), 5), 1, _MAX_MIN);
        var updatedConfig = {
            ...config,
            smartAutoPause: {
              enabled: sapEnabled,
              blurMinutes: sapBlurMin,
              hiddenMinutes: sapHiddenMin,
              idleMinutes: sapIdleMin,
              useIdleDetection: sapUseIdle,
              respectPiP: sapRespect,
              ignoreShortUnderSec: sapIgnoreShort
            },
            playerTheme: formData.get('playerTheme'),
            playerStyle: formData.get('playerStyle'),
            defaultLanguage: formData.get('defaultLanguage'),
            dateLocale: formData.get('dateLocale') || 'pt-BR',
            sliderDuration: parseInt(formData.get('sliderDuration'), 10),
            limit: parseInt(formData.get('limit'), 10),
            onlyUnwatchedRandom: formData.get('onlyUnwatchedRandom') === 'on',
            maxShufflingLimit: parseInt(formData.get('maxShufflingLimit'), 10),
            excludeEpisodesFromPlaying: formData.get('excludeEpisodesFromPlaying') === 'on',
            showPlaybackProgress: formData.get('showPlaybackProgress') === 'on',
            playingLimit: parseFloat(formData.get('playingLimit')),
            atrasoTrailer: parseInt(formData.get('atrasoTrailer'), 10),
            cssVariant: formData.get('cssVariant'),
            useAlbumArtAsBackground: formData.get('useAlbumArtAsBackground') === 'on',
            albumArtBackgroundBlur: parseInt(formData.get('albumArtBackgroundBlur')),
            albumArtBackgroundOpacity: parseFloat(formData.get('albumArtBackgroundOpacity')),
            shuffleSeedLimit: parseInt(formData.get('shuffleSeedLimit'), 10),
            balanceItemTypes: formData.get('balanceItemTypes') === 'on',
            showCast,
            showProgressBar: false,
            showProgressAsSeconds: formData.get('showProgressAsSeconds') === 'on',
            enableTrailerPlayback: formData.get('enableTrailerPlayback') === 'on',
            enableVideoPlayback: formData.get('enableVideoPlayback') === 'on',
            manualBackdropSelection: formData.get('manualBackdropSelection') === 'on',
            indexZeroSelection: formData.get('indexZeroSelection') === 'on',
            backdropImageType: formData.get('backdropImageType'),
            minHighQualityWidth: parseInt(formData.get('minHighQualityWidth'), 10),
            backdropMaxWidth: parseInt(formData.get('backdropMaxWidth'), 10),
            minPixelCount: parseInt(formData.get('minPixelCount'), 10),
            enableImageSizeFilter: formData.get('enableImageSizeFilter') === 'on',
            minImageSizeKB: parseInt(formData.get('minImageSizeKB'), 10),
            maxImageSizeKB: parseInt(formData.get('maxImageSizeKB'), 10),
            showDotNavigation: formData.get('showDotNavigation') === 'on',
            dotBackgroundImageType: formData.get('dotBackgroundImageType'),
            dotVisibleCount: Math.max(0, _intOr(formData.get('dotVisibleCount'), config.dotVisibleCount || 0)),
            dotBackgroundBlur: parseInt(formData.get('dotBackgroundBlur')),
            dotBackgroundOpacity: parseFloat(formData.get('dotBackgroundOpacity')),
            dotPosterMode: formData.get('dotPosterMode') === 'on',
            createAvatar: formData.get('createAvatar') === 'on',
            avatarWidth: parseInt(formData.get('avatarWidth'), 10),
            avatarHeight: parseInt(formData.get('avatarHeight'), 10),
            avatarFontSize: parseInt(formData.get('avatarFontSize'), 10),
            avatarTextShadow: formData.get('avatarTextShadow'),
            avatarColorMethod: formData.get('avatarColorMethod'),
            avatarSolidColor: formData.get('avatarSolidColor'),
            avatarGradient: formData.get('avatarGradient'),
            avatarFontFamily: formData.get('avatarFontFamily') || 'Righteous',
            avatarStyle: formData.get('avatarStyle') || 'dicebear',
            dicebearStyle: formData.get('dicebearStyle') || 'Adventurer',
            dicebearBackgroundColor: formData.get('dicebearBackgroundColor') || 'transparent',
            dicebearRadius: parseInt(formData.get('dicebearRadius'), 10) || 50,
            avatarScale: parseFloat(formData.get('avatarScale')) || 1,
            dicebearBackgroundEnabled: formData.get('dicebearBackgroundEnabled') === 'on',
            dicebearPosition: formData.get('dicebearPosition') === 'on',
            autoRefreshAvatar: formData.get('autoRefreshAvatar') === 'on',
            avatarRefreshTime: parseInt(formData.get('avatarRefreshTime'), 10),
            randomDicebearAvatar: formData.get('randomDicebearAvatar') === 'on',
            dicebearParams: config.dicebearParams || {},
            previewModal: formData.get('previewModal') === 'on',
            allPreviewModal: formData.get('allPreviewModal') === 'on',
            preferTrailersInPreviewModal: formData.get('preferTrailersInPreviewModal') === 'on',
            onlyTrailerInPreviewModal: formData.get('onlyTrailerInPreviewModal') === 'on',
            dotPreviewPlaybackMode: function(() {
              var v = formData.get('dotPreviewPlaybackMode');
              if (v === 'trailer' || v === 'video' || v === 'onlyTrailer') return v;
              return null;
            })(),
            previewPlaybackMode: function(() {
              if (formData.get('disableAllPlayback') === 'on') return 'none';
              if (formData.get('enableTrailerThenVideo') === 'on') return 'trailerThenVideo';
              if (formData.get('enableTrailerPlayback') === 'on') return 'trailer';
              if (formData.get('enableVideoPlayback') === 'on') return 'video';
              return 'video';
            })(),
            globalPreviewMode: formData.get('globalPreviewMode') || 'modal',
            enabledGmmp: formData.get('enabledGmmp') === 'on',
            enableQualityBadges: formData.get('enableQualityBadges') === 'on',
            enableTrailerThenVideo: formData.get('enableTrailerThenVideo') === 'on',
            disableAllPlayback: formData.get('disableAllPlayback') === 'on',
            enableSlider: formData.get('enableSlider') === 'on',
            onlyShowSliderOnHomeTab: formData.get('onlyShowSliderOnHomeTab') === 'on',
            enableNotifications: formData.get('enableNotifications') === 'on',
            enableToastNew: formData.get('enableToastNew') === 'on',
            enableToastSystem: formData.get('enableToastSystem') === 'on',
            maxNotifications: parseInt(formData.get('maxNotifications'), 10),
            toastDuration: parseInt(formData.get('toastDuration'), 10),
            renderResume: parseInt(formData.get('renderResume'), 10),
            enableRenderResume: formData.get('enableRenderResume') === 'on',
            toastGroupThreshold: parseInt(formData.get('toastGroupThreshold'), 10),
            enableCounterSystem: formData.get('enableCounterSystem') === 'on',
            enableHomeSectionsMaster: formData.get('enableHomeSectionsMaster') === 'on',
            enablePauseFeaturesMaster: formData.get('enablePauseFeaturesMaster') === 'on',
            enableSubtitleCustomizerModule: formData.get('enableSubtitleCustomizerModule') === 'on',
            enableParentalPinModule: formData.get('enableParentalPinModule') === 'on',
            enableDetailsModalModule: formData.get('enableDetailsModalModule') === 'on',
            enableCastModule,
            allowSharedCastViewerForUsers,
            detailsModalTmdbReviewsEnabled: formData.get('detailsModalTmdbReviewsEnabled') === 'on',
            detailsModalLocalCommentsEnabled: formData.get('detailsModalLocalCommentsEnabled') === 'on',
            enableCustomSplashScreen: formData.get('enableCustomSplashScreen') === 'on',
            customSplashTitle: String(formData.get('customSplashTitle') || '').trim(),
            settingsHotkey: normalizeSettingsHotkey(
              formData.get('settingsHotkey'),
              config.settingsHotkey || SETTINGS_HOTKEY_DEFAULT
            ),

            enableDirectorRows: formData.get('enableDirectorRows') === 'on',
            showDirectorRowsHeroCards: formData.get('showDirectorRowsHeroCards') === 'on',
            directorRowsCount: _intOr(formData.get('directorRowsCount'), config.directorRowsCount || 4),
            directorRowsMinItemsPerDirector: _intOr(formData.get('directorRowsMinItemsPerDirector'), config.directorRowsMinItemsPerDirector || 8),
            directorRowCardCount: parseInt(formData.get('directorRowCardCount'), 10),
            placeDirectorRowsAtBottom: formData.get('placeDirectorRowsAtBottom') === 'on',
            directorRowsUseTopGenres: formData.get('directorRowsUseTopGenres') === 'on',

            becauseYouWatchedRowCount: parseInt(formData.get('becauseYouWatchedRowCount'), 10),
            becauseYouWatchedCardCount: parseInt(formData.get('becauseYouWatchedCardCount'), 10),
            enableBecauseYouWatched: formData.get('enableBecauseYouWatched') === 'on',

            enableProfileChooser: formData.get('enableProfileChooser') === 'on',
            profileChooserAutoOpen: formData.get('profileChooserAutoOpen') === 'on',
            profileChooserAutoOpenRequireQuickLogin: boolFromFd(
              'profileChooserAutoOpenRequireQuickLogin',
              config.profileChooserAutoOpenRequireQuickLogin !== false
            ),
            profileChooserRememberTokens: formData.get('profileChooserRememberTokens') === 'on',

            enableRecentRows: formData.get('enableRecentRows') === 'on',
            showRecentRowsHeroCards: formData.get('showRecentRowsHeroCards') === 'on',
            showRecentMoviesHeroCards: formData.get('showRecentMoviesHeroCards') === 'on',
            showRecentSeriesHeroCards: formData.get('showRecentSeriesHeroCards') === 'on',
            showRecentMusicHeroCards: formData.get('showRecentMusicHeroCards') === 'on',
            showRecentTracksHeroCards: formData.get('showRecentTracksHeroCards') === 'on',
            showRecentEpisodesHeroCards: formData.get('showRecentEpisodesHeroCards') === 'on',
            showNextUpHeroCards: formData.get('showNextUpHeroCards') === 'on',
            enableTop10MoviesRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableTop10MoviesRow') === 'on';
            })(),
            enableTop10SeriesRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableTop10SeriesRow') === 'on';
            })(),
            enableTmdbTopMoviesRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableTmdbTopMoviesRow') === 'on';
            })(),
            enableRecentMoviesRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentMoviesRow') === 'on';
            })(),
            enableRecentSeriesRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentSeriesRow') === 'on';
            })(),
            enableRecentMusicRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentMusicRow') === 'on';
            })(),
            enableRecentMusicTracksRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentMusicTracksRow') === 'on';
            })(),
            enableRecentEpisodesRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableRecentEpisodesRow') === 'on';
            })(),
            enableNextUpRow: function(() {
              var master = formData.get('enableRecentRows') === 'on';
              if (!master) return false;
              return formData.get('enableNextUpRow') === 'on';
            })(),

            recentMoviesCardCount: function(() {
              var v = parseInt(formData.get('recentMoviesCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.recentMoviesCardCount) && config.recentMoviesCardCount > 0) return config.recentMoviesCardCount;
            })(),
            recentSeriesCardCount: function(() {
              var v = parseInt(formData.get('recentSeriesCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.recentSeriesCardCount) && config.recentSeriesCardCount > 0) return config.recentSeriesCardCount;
            })(),
            recentMusicCardCount: function(() {
              var v = parseInt(formData.get('recentMusicCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.recentMusicCardCount) && config.recentMusicCardCount > 0) return config.recentMusicCardCount;
              return 10;
            })(),
            recentEpisodesCardCount: function(() {
              var v = parseInt(formData.get('recentEpisodesCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.recentEpisodesCardCount) && config.recentEpisodesCardCount > 0) return config.recentEpisodesCardCount;
              return 10;
            })(),
            nextUpCardCount: function(() {
              var v = parseInt(formData.get('nextUpCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.nextUpCardCount) && config.nextUpCardCount > 0) return config.nextUpCardCount;
              return 10;
            })(),

            enableContinueMovies: formData.get('enableContinueMovies') === 'on',
            showContinueMoviesHeroCards: formData.get('showContinueMoviesHeroCards') === 'on',
            continueMoviesCardCount: parseInt(formData.get('continueMoviesCardCount'), 10) || config.continueMoviesCardCount || 10,
            enableContinueSeries: formData.get('enableContinueSeries') === 'on',
            showContinueSeriesHeroCards: formData.get('showContinueSeriesHeroCards') === 'on',
            continueSeriesCardCount: parseInt(formData.get('continueSeriesCardCount'), 10) || config.continueSeriesCardCount || 10,

            recentRowsSplitTvLibs: formData.get('recentRowsSplitTvLibs') === 'on',
            recentRowsSplitMovieLibs: formData.get('recentRowsSplitMovieLibs') === 'on',

            recentMoviesLibIds: function(() {
              var raw = formData.get('recentMoviesLibIds');
              if (!raw) return config.recentMoviesLibIds || [];
              try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return config.recentMoviesLibIds || []; }
            })(),

            recentSeriesTvLibIds: function(() {
              var raw = formData.get('recentSeriesTvLibIds');
              if (!raw) return config.recentSeriesTvLibIds || [];
              try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return config.recentSeriesTvLibIds || []; }
            })(),
            recentEpisodesTvLibIds: function(() {
              var raw = formData.get('recentEpisodesTvLibIds');
              if (!raw) return config.recentEpisodesTvLibIds || [];
              try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return config.recentEpisodesTvLibIds || []; }
            })(),
            continueSeriesTvLibIds: function(() {
              var raw = formData.get('continueSeriesTvLibIds');
              if (!raw) return config.continueSeriesTvLibIds || [];
              try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return config.continueSeriesTvLibIds || []; }
            })(),

            enableOtherLibRows: formData.get('enableOtherLibRows') === 'on',
            showOtherLibrariesHeroCards: formData.get('showOtherLibrariesHeroCards') === 'on',
            otherLibrariesRecentCardCount: function(() {
              var v = parseInt(formData.get('otherLibrariesRecentCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.otherLibrariesRecentCardCount) && config.otherLibrariesRecentCardCount > 0) return config.otherLibrariesRecentCardCount;
              return 10;
            })(),
            otherLibrariesContinueCardCount: function(() {
              var v = parseInt(formData.get('otherLibrariesContinueCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.otherLibrariesContinueCardCount) && config.otherLibrariesContinueCardCount > 0) return config.otherLibrariesContinueCardCount;
              return 10;
            })(),
            otherLibrariesEpisodesCardCount: function(() {
              var v = parseInt(formData.get('otherLibrariesEpisodesCardCount'), 10);
              if (Number.isFinite(v) && v > 0) return v;
              if (Number.isFinite(config.otherLibrariesEpisodesCardCount) && config.otherLibrariesEpisodesCardCount > 0) return config.otherLibrariesEpisodesCardCount;
              return 10;
            })(),
            otherLibrariesIds: function(() {
              var raw = formData.get('otherLibrariesIds');
              if (!raw) return config.otherLibrariesIds || [];
              try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return config.otherLibrariesIds || []; }
            })(),

            enableStudioHubs: formData.get('enableStudioHubs') === 'on',
            studioHubsColorize: formData.get('studioHubsColorize') === 'on',
            enablePersonalRecommendations: formData.get('enablePersonalRecommendations') === 'on',
            showPersonalRecsHeroCards: formData.get('showPersonalRecsHeroCards') === 'on',
            managedCardTitleDisplayMode: normalizeManagedCardTitleDisplayMode(
              formData.get('managedCardTitleDisplayMode') ||
              config.managedCardTitleDisplayMode
            ),
            personalRecsCacheTtlMs: parseInt(formData.get('personalRecsCacheTtlMs'), 10) || 360,
            studioHubsAutoAddFromWatchlistCopy: formData.get('studioHubsAutoAddFromWatchlistCopy') === 'on',
            studioHubsHoverVideo: formData.get('studioHubsHoverVideo') === 'on',
            placeGenreHubsAbovePersonalRecs: formData.get('placeGenreHubsAbovePersonalRecs') === 'on',
            studioMiniTrailerPopover: formData.get('studioMiniTrailerPopover') === 'on',
            studioHubsMinRating: parseFloat(formData.get('studioHubsMinRating')) || 6.5,
            studioHubsCardCount: parseInt(formData.get('studioHubsCardCount'), 10) || 10,
            personalRecsCardCount: parseInt(formData.get('personalRecsCardCount'), 10) || 9,
            studioHubsOrder: useGlobalStudioHubsVisibility
              ? (studioHubsOrderValue.length ? studioHubsOrderValue : getConfig().studioHubsOrder)
              : undefined,
            studioHubsHidden: useGlobalStudioHubsVisibility ? studioHubsHiddenValue : undefined,
            managedHomeSectionOrder: managedHomeSectionOrderValue,

            enableGenreHubs: formData.get('enableGenreHubs') === 'on',
            showGenreHubsHeroCards: formData.get('showGenreHubsHeroCards') === 'on',
            studioHubsGenreCardCount: parseInt(formData.get('studioHubsGenreCardCount'), 10) || 10,
            studioHubsGenreRowsCount: parseInt(formData.get('studioHubsGenreRowsCount'), 10) || 3,
            genreHubsOrder: function(() {
              var raw = formData.get('genreHubsOrder');
              if (!raw) return getConfig().genreHubsOrder;
              try {
                var arr = JSON.parse(raw);
                return Array.isArray(arr) && arr.length ? arr : getConfig().genreHubsOrder;
              } catch {
                return getConfig().genreHubsOrder;
              }
            })(),

            showStatusInfo: formData.get('showStatusInfo') === 'on',
            showTypeInfo: formData.get('showTypeInfo') === 'on',
            showWatchedInfo: formData.get('showWatchedInfo') === 'on',
            showRuntimeInfo: formData.get('showRuntimeInfo') === 'on',
            showQualityInfo: formData.get('showQualityInfo') === 'on',
            showQualityDetail: formData.get('showQualityDetail') === 'on',
            showRatingInfo: formData.get('showRatingInfo') === 'on',
            showMatchPercentage: formData.get('showMatchPercentage') === 'on',
            metaIconColors: formData.get('metaIconColors') === 'on',
            showCommunityRating: formData.get('showCommunityRating') === 'on',
            showCriticRating: formData.get('showCriticRating') === 'on',
            showOfficialRating: formData.get('showOfficialRating') === 'on',

            showActorAll: formData.get('showActorAll') === 'on',
            showActorInfo: formData.get('showActorInfo') === 'on',
            showActorImg: formData.get('showActorImg') === 'on',
            showActorRole: formData.get('showActorRole') === 'on',
            artistLimit: parseInt(formData.get('artistLimit'), 10),

            showDirectorWriter: formData.get('showDirectorWriter') === 'on',
            showDirector: formData.get('showDirector') === 'on',
            showWriter: formData.get('showWriter') === 'on',
            tempoAtivo: parseInt(formData.get('tempoAtivo'), 10),
            tempoEntrada: parseInt(formData.get('tempoEntrada'), 10),
            allowedWriters: formData.get('allowedWriters') ?
                formData.get('allowedWriters').split(',').map(function(w) w.trim()) : [],

            limiteMusica: parseInt(formData.get('limiteMusica'), 10),
            nextTrack: parseInt(formData.get('nextTrack'), 10) || 30,
            topTrack: parseInt(formData.get('topTrack'), 10) || 100,
            limiteFaixa: parseInt(formData.get('limiteFaixa'), 10),
            limiteId3: parseInt(formData.get('limiteId3'), 10),
            limiteCacheTagsId3: parseInt(formData.get('limiteCacheTagsId3'), 10) || 500,
            limiteCacheImagensId3: parseInt(formData.get('limiteCacheImagensId3'), 10) || 200,
            usarBase64ImagensId3: formData.get('usarBase64ImagensId3') === 'on',
            limiteAlbum: parseInt(formData.get('limiteAlbum'), 10),
            limiteLote: parseInt(formData.get('limiteLote'), 10),
            limiteHistorico: parseInt(formData.get('limiteHistorico'), 10),
            maxExcludeIdsForUri: parseInt(formData.get('maxExcludeIdsForUri'), 10),
            notificationsEnabled: formData.get('notificationsEnabled') === 'on',
            nextTracksSource: formData.get('nextTracksSource'),

            useListFile: false,
            useManualList: formData.get('useManualList') === 'on',
            manualListIds: formData.get('manualListIds'),
            customQueryString: function(() {
              var raw = formData.get('customQueryString').trim();
              if (!raw) {
                return getConfig().customQueryString;
              }
              return raw;
            })(),
            sortingKeywords: function(() {
              var raw = formData.get('sortingKeywords').trim();
              if (!raw) {
                return getConfig().sortingKeywords;
              }
              return raw.split(',').map(function(k) k.trim());
            })(),

            showLanguageInfo: formData.get('showLanguageInfo') === 'on',

            showLogoOrTitle: formData.get('showLogoOrTitle') === 'on',
            displayOrder: formData.get('displayOrder') || 'logo,disk,originalTitle',
            showTitleOnly: formData.get('showTitleOnly') === 'on',
            showDiscOnly: formData.get('showDiscOnly') === 'on',

            showDescriptions: formData.get('showDescriptions') === 'on',
            showSloganInfo: formData.get('showSloganInfo') === 'on',
            showTitleInfo: formData.get('showTitleInfo') === 'on',
            showOriginalTitleInfo: formData.get('showOriginalTitleInfo') === 'on',
            hideOriginalTitleIfSame: formData.get('hideOriginalTitleIfSame') === 'on',
            showPlotInfo: formData.get('showPlotInfo') === 'on',

            showProviderInfo: formData.get('showProviderInfo') === 'on',
            showSettingsLink: formData.get('showSettingsLink') === 'on',
            showTrailerIcon: formData.get('showTrailerIcon') === 'on',

            showTrailerButton: formData.get('showTrailerButton') === 'on',
            trailerBackgroundImageType: formData.get('trailerBackgroundImageType'),
            showWatchButton: formData.get('showWatchButton') === 'on',
            watchBackgroundImageType: formData.get('watchBackgroundImageType'),
            showFavoriteButton: formData.get('showFavoriteButton') === 'on',
            favoriteBackgroundImageType: formData.get('favoriteBackgroundImageType'),
            watchlistTabsSliderEnabled: formData.get('watchlistTabsSliderEnabled') === 'on',
            watchlistAutoRemovePlayed: formData.get('watchlistAutoRemovePlayed') === 'on',
            watchlistAutoRemovePlayedFromFavorites: formData.get('watchlistAutoRemovePlayedFromFavorites') === 'on',
            watchlistImportFavoritesOnStartup: formData.get('watchlistImportFavoritesOnStartup') === 'on',
            showPlayedButton: formData.get('showPlayedButton') === 'on',
            playedBackgroundImageType: formData.get('playedBackgroundImageType'),
            buttonBackgroundBlur: parseInt(formData.get('buttonBackgroundBlur')),
            buttonBackgroundOpacity: parseFloat(formData.get('buttonBackgroundOpacity')),

            showInfo: formData.get('showInfo') === 'on',
            showGenresInfo: formData.get('showGenresInfo') === 'on',
            showYearInfo: formData.get('showYearInfo') === 'on',
            showCountryInfo: formData.get('showCountryInfo') === 'on',

            homeSectionsTop: parseInt(formData.get('homeSectionsTop'), 10) || 0,
            slideTop: parseInt(formData.get('slideTop'), 10) || 0,
            slideLeft: parseInt(formData.get('slideLeft'), 10) || 0,
            slideWidth: parseInt(formData.get('slideWidth'), 10) || 0,
            slideHeight: parseInt(formData.get('slideHeight'), 10) || 0,

            logoContainerTop: parseInt(formData.get('logoContainerTop'), 10) || 0,
            logoContainerLeft: parseInt(formData.get('logoContainerLeft'), 10) || 0,
            logoContainerWidth: parseInt(formData.get('logoContainerWidth'), 10) || 0,
            logoContainerHeight: parseInt(formData.get('logoContainerHeight'), 10) || 0,
            logoContainerDisplay: formData.get('logoContainerDisplay'),
            logoContainerFlexDirection: formData.get('logoContainerFlexDirection'),
            logoContainerJustifyContent: formData.get('logoContainerJustifyContent'),
            logoContainerAlignItems: formData.get('logoContainerAlignItems'),
            logoContainerFlexWrap: formData.get('logoContainerFlexWrap'),

            buttonContainerTop: parseInt(formData.get('buttonContainerTop'), 10) || 0,
            buttonContainerLeft: parseInt(formData.get('buttonContainerLeft'), 10) || 0,
            buttonContainerWidth: parseInt(formData.get('buttonContainerWidth'), 10) || 0,
            buttonContainerHeight: parseInt(formData.get('buttonContainerHeight'), 10) || 0,
            buttonContainerDisplay: formData.get('buttonContainerDisplay'),
            buttonContainerFlexDirection: formData.get('buttonContainerFlexDirection'),
            buttonContainerJustifyContent: formData.get('buttonContainerJustifyContent'),
            buttonContainerAlignItems: formData.get('buttonContainerAlignItems'),
            buttonContainerFlexWrap: formData.get('buttonContainerFlexWrap'),

            metaContainerTop: parseInt(formData.get('metaContainerTop'), 10) || 0,
            metaContainerLeft: parseInt(formData.get('metaContainerLeft'), 10) || 0,
            metaContainerWidth: parseInt(formData.get('metaContainerWidth'), 10) || 0,
            metaContainerHeight: parseInt(formData.get('metaContainerHeight'), 10) || 0,
            metaContainerDisplay: formData.get('metaContainerDisplay'),
            metaContainerFlexDirection: formData.get('metaContainerFlexDirection'),
            metaContainerJustifyContent: formData.get('metaContainerJustifyContent'),
            metaContainerAlignItems: formData.get('metaContainerAlignItems'),
            metaContainerFlexWrap: formData.get('metaContainerFlexWrap'),

            plotContainerTop: parseInt(formData.get('plotContainerTop'), 10) || 0,
            plotContainerLeft: parseInt(formData.get('plotContainerLeft'), 10) || 0,
            plotContainerWidth: parseInt(formData.get('plotContainerWidth'), 10) || 0,
            plotContainerHeight: parseInt(formData.get('plotContainerHeight'), 10) || 0,
            plotContainerDisplay: formData.get('plotContainerDisplay'),
            plotContainerFlexDirection: formData.get('plotContainerFlexDirection'),
            plotContainerJustifyContent: formData.get('plotContainerJustifyContent'),
            plotContainerAlignItems: formData.get('plotContainerAlignItems'),
            plotContainerFlexWrap: formData.get('plotContainerFlexWrap'),
            plotContainerFontSize: parseInt(formData.get('plotContainerFontSize'), 10) || 0,
            plotContainerColor: parseInt(formData.get('plotContainerColor'), 10) || 0,

            titleContainerTop: parseInt(formData.get('titleContainerTop'), 10) || 0,
            titleContainerLeft: parseInt(formData.get('titleContainerLeft'), 10) || 0,
            titleContainerWidth: parseInt(formData.get('titleContainerWidth'), 10) || 0,
            titleContainerHeight: parseInt(formData.get('titleContainerHeight'), 10) || 0,
            titleContainerDisplay: formData.get('titleContainerDisplay'),
            titleContainerFlexDirection: formData.get('titleContainerFlexDirection'),
            titleContainerJustifyContent: formData.get('titleContainerJustifyContent'),
            titleContainerAlignItems: formData.get('titleContainerAlignItems'),
            titleContainerFlexWrap: formData.get('titleContainerFlexWrap'),

            directorContainerTop: parseInt(formData.get('directorContainerTop'), 10) || 0,
            directorContainerLeft: parseInt(formData.get('directorContainerLeft'), 10) || 0,
            directorContainerWidth: parseInt(formData.get('directorContainerWidth'), 10) || 0,
            directorContainerHeight: parseInt(formData.get('directorContainerHeight'), 10) || 0,
            directorContainerDisplay: formData.get('directorContainerDisplay'),
            directorContainerFlexDirection: formData.get('directorContainerFlexDirection'),
            directorContainerJustifyContent: formData.get('directorContainerJustifyContent'),
            directorContainerAlignItems: formData.get('directorContainerAlignItems'),
            directorContainerFlexWrap: formData.get('directorContainerFlexWrap'),

            infoContainerTop: parseInt(formData.get('infoContainerTop'), 10) || 0,
            infoContainerLeft: parseInt(formData.get('infoContainerLeft'), 10) || 0,
            infoContainerWidth: parseInt(formData.get('infoContainerWidth'), 10) || 0,
            infoContainerHeight: parseInt(formData.get('infoContainerHeight'), 10) || 0,
            infoContainerDisplay: formData.get('infoContainerDisplay'),
            infoContainerFlexDirection: formData.get('infoContainerFlexDirection'),
            infoContainerJustifyContent: formData.get('infoContainerJustifyContent'),
            infoContainerAlignItems: formData.get('infoContainerAlignItems'),
            infoContainerFlexWrap: formData.get('infoContainerFlexWrap'),

            mainContainerTop: parseInt(formData.get('mainContainerTop'), 10) || 0,
            mainContainerLeft: parseInt(formData.get('mainContainerLeft'), 10) || 0,
            mainContainerWidth: parseInt(formData.get('mainContainerWidth'), 10) || 0,
            mainContainerHeight: parseInt(formData.get('mainContainerHeight'), 10) || 0,
            mainContainerDisplay: formData.get('mainContainerDisplay'),
            mainContainerFlexDirection: formData.get('mainContainerFlexDirection'),
            mainContainerJustifyContent: formData.get('mainContainerJustifyContent'),
            mainContainerAlignItems: formData.get('mainContainerAlignItems'),
            mainContainerFlexWrap: formData.get('mainContainerFlexWrap'),

            sliderContainerTop: parseInt(formData.get('sliderContainerTop'), 10) || 0,
            sliderContainerLeft: parseInt(formData.get('sliderContainerLeft'), 10) || 0,
            sliderContainerWidth: parseInt(formData.get('sliderContainerWidth'), 10) || 0,
            sliderContainerHeight: parseInt(formData.get('sliderContainerHeight'), 10) || 0,
            sliderContainerDisplay: formData.get('sliderContainerDisplay'),
            sliderContainerFlexDirection: formData.get('sliderContainerFlexDirection'),
            sliderContainerJustifyContent: formData.get('sliderContainerJustifyContent'),
            sliderContainerAlignItems: formData.get('sliderContainerAlignItems'),
            sliderContainerFlexWrap: formData.get('sliderContainerFlexWrap'),

            providerContainerTop: parseInt(formData.get('providerContainerTop'), 10) || 0,
            providerContainerLeft: parseInt(formData.get('providerContainerLeft'), 10) || 0,
            providerContainerWidth: parseInt(formData.get('providerContainerWidth'), 10) || 0,
            providerContainerHeight: parseInt(formData.get('providerContainerHeight'), 10) || 0,
            providerContainerDisplay: formData.get('providerContainerDisplay'),
            providerContainerFlexDirection: formData.get('providerContainerFlexDirection'),
            providerContainerJustifyContent: formData.get('providerContainerJustifyContent'),
            providerContainerAlignItems: formData.get('providerContainerAlignItems'),
            providerContainerFlexWrap: formData.get('providerContainerFlexWrap'),

            providericonsContainerTop: parseInt(formData.get('providericonsContainerTop'), 10) || 0,
            providericonsContainerLeft: parseInt(formData.get('providericonsContainerLeft'), 10) || 0,
            providericonsContainerWidth: parseInt(formData.get('providericonsContainerWidth'), 10) || 0,
            providericonsContainerHeight: parseInt(formData.get('providericonsContainerHeight'), 10) || 0,
            providericonsContainerDisplay: formData.get('providericonsContainerDisplay'),
            providericonsContainerFlexDirection: formData.get('providericonsContainerFlexDirection'),
            providericonsContainerJustifyContent: formData.get('providericonsContainerJustifyContent'),
            providericonsContainerAlignItems: formData.get('providericonsContainerAlignItems'),
            providericonsContainerFlexWrap: formData.get('providericonsContainerFlexWrap'),

            statusContainerTop: parseInt(formData.get('statusContainerTop'), 10) || 0,
            statusContainerLeft: parseInt(formData.get('statusContainerLeft'), 10) || 0,
            statusContainerWidth: parseInt(formData.get('statusContainerWidth'), 10) || 0,
            statusContainerHeight: parseInt(formData.get('statusContainerHeight'), 10) || 0,
            statusContainerDisplay: formData.get('statusContainerDisplay'),
            statusContainerFlexDirection: formData.get('statusContainerFlexDirection'),
            statusContainerJustifyContent: formData.get('statusContainerJustifyContent'),
            statusContainerAlignItems: formData.get('statusContainerAlignItems'),
            statusContainerFlexWrap: formData.get('statusContainerFlexWrap'),

            ratingContainerTop: parseInt(formData.get('ratingContainerTop'), 10) || 0,
            ratingContainerLeft: parseInt(formData.get('ratingContainerLeft'), 10) || 0,
            ratingContainerWidth: parseInt(formData.get('ratingContainerWidth'), 10) || 0,
            ratingContainerHeight: parseInt(formData.get('ratingContainerHeight'), 10) || 0,
            ratingContainerDisplay: formData.get('ratingContainerDisplay'),
            ratingContainerFlexDirection: formData.get('ratingContainerFlexDirection'),
            ratingContainerJustifyContent: formData.get('ratingContainerJustifyContent'),
            ratingContainerAlignItems: formData.get('ratingContainerAlignItems'),
            ratingContainerFlexWrap: formData.get('ratingContainerFlexWrap'),

            existingDotContainerTop: parseInt(formData.get('existingDotContainerTop'), 10) || 0,
            existingDotContainerLeft: parseInt(formData.get('existingDotContainerLeft'), 10) || 0,
            existingDotContainerWidth: parseInt(formData.get('existingDotContainerWidth'), 10) || 0,
            existingDotContainerHeight: parseInt(formData.get('existingDotContainerHeight'), 10) || 0,
            existingDotContainerDisplay: formData.get('existingDotContainerDisplay'),
            existingDotContainerFlexDirection: formData.get('existingDotContainerFlexDirection'),
            existingDotContainerJustifyContent: formData.get('existingDotContainerJustifyContent'),
            existingDotContainerAlignItems: formData.get('existingDotContainerAlignItems'),
            existingDotContainerFlexWrap: formData.get('existingDotContainerFlexWrap'),

            progressBarTop: parseInt(formData.get('progressBarTop'), 10) || 0,
            progressBarLeft: parseInt(formData.get('progressBarLeft'), 10) || 0,
            progressBarWidth: parseInt(formData.get('progressBarWidth'), 10) || 100,
            progressBarHeight: parseInt(formData.get('progressBarHeight'), 10) || 0,

            progressSecondsTop: parseInt(formData.get('progressSecondsTop'), 10) || 0,
            progressSecondsLeft: parseInt(formData.get('progressSecondsLeft'), 10) || 0,
            peakDiagonal: formData.get('peakDiagonal') === 'on',
            peakSpanRight: parseInt(formData.get('peakSpanRight'), 10) || 3,
            peakSpanLeft: parseInt(formData.get('peakSpanLeft'), 10) || 3,
            peakGapLeft: parseInt(formData.get('peakGapLeft'), 10) || 80,
            peakGapRight: parseInt(formData.get('peakGapRight'), 10) || 80,
            peakGapY: parseInt(formData.get('peakGapY'), 10) || 0,

            pauseOverlay: {
              enabled: formData.get('pauseOverlay') === 'on',
              cssVariant: function(() {
                var value = String(formData.get('pauseOverlayCssVariant') || '').trim();
                return value === 'moduloPausa2' ? 'moduloPausa2' : 'moduloPausa';
              })(),
              imagePreference: formData.get('pauseOverlayImagePreference') || 'auto',
              showPlot: formData.get('pauseOverlayShowPlot') === 'on',
              debug: formData.get('pauseOverlayDebug') === 'on',
              requireWebSocket: formData.get('pauseOverlayRequireWebSocket') === 'on',
              showMetadata: formData.get('pauseOverlayShowMetadata') === 'on',
              showLogo: formData.get('pauseOverlayShowLogo') === 'on',
              closeOnMouseMove: formData.get('pauseOverlayCloseOnMouseMove') === 'on',
              showBackdrop: formData.get('pauseOverlayShowBackdrop') === 'on',
              showOsdHeaderRatings: formData.get('pauseOverlayShowOsdHeaderRatings') === 'on',
              showOsdHeaderCommunityRating: formData.get('pauseOverlayShowOsdHeaderCommunityRating') === 'on',
              showOsdHeaderCriticRating: formData.get('pauseOverlayShowOsdHeaderCriticRating') === 'on',
              showOsdHeaderOfficialRating: formData.get('pauseOverlayShowOsdHeaderOfficialRating') === 'on',
              minVideoMinutes: pauseOverlayMinDurMin,
              showAgeBadge: formData.get('pauseOverlayShowAgeBadge') === 'on',
              ageBadgeDurationMs: Math.max(1000, (parseInt(formData.get('ageBadgeDurationSec'), 10) || 6) * 1000),
              ageBadgeLockMs: Math.max(0, (parseInt(formData.get('ageBadgeLockSec'), 10) || 6) * 1000),
              badgeDelayMs: Math.max(1000, (parseInt(formData.get('badgeDelayMs'), 10) || 5) * 1000),
              badgeDelayResumeMs: Math.max(1000, (parseInt(formData.get('badgeDelayResumeMs'), 10) || 2) * 1000),
              ageBadgeDurationResumeMs: Math.max(1000, (parseInt(formData.get('ageBadgeDurationResumeMs'), 10) || 10) * 1000),
            },
            slideTransitionType: formData.get('slideTransitionType'),
            dotPosterTransitionType: formData.get('dotPosterTransitionType'),
            enableSlideAnimations: formData.get('enableSlideAnimations') === 'on',
            enableDotPosterAnimations: formData.get('enableDotPosterAnimations') === 'on',
            slideAnimationDuration: parseInt(formData.get('slideAnimationDuration'), 10) || 800,
            dotPosterAnimationDuration: parseInt(formData.get('dotPosterAnimationDuration'), 10) || 500,
        };

        try {
          localStorage.setItem('smartAutoPause', JSON.stringify(updatedConfig.smartAutoPause));
          localStorage.setItem('pauseOverlay', JSON.stringify(updatedConfig.pauseOverlay));
        } catch {}

        if (updatedConfig.enableDetailsModalModule === false) {
          try {
            closeDetailsModalIfLoaded();
          } catch {}
        }

        if (!useGlobalStudioHubsVisibility) {
          try {
            saveStudioHubVisibility(studioHubsHiddenValue, {
              profile: studioHubsVisibilityProfile,
              orderNames: studioHubsOrderValue
            });
          } finally {
            try { localStorage.removeItem('studioHubsHidden'); } catch {}
            try { localStorage.removeItem('studioHubsOrder'); } catch {}
          }
        }

        var toSave =
          (cfgGuard.forceGlobalUserSettings && !isAdmin)
            ? pick(updatedConfig, USER_ONLY_KEYS)
            : updatedConfig;

        var hasTmdbApiKeyField = formData.has('TmdbApiKey');
        var tmdbApiKey = String(formData.get('TmdbApiKey') || '').trim();

        var rawInput = formData.get('sortingKeywords').trim();
        updateConfig(toSave);
        try {
          window.__JMS_CUSTOM_SPLASH__.syncFromConfig.(updatedConfig.enableCustomSplashScreen);
        } catch {}
        try { localStorage.removeItem('placePersonalRecsUnderStudioHubs'); } catch {}
        localStorage.removeItem('gradientOverlayImageType');

        if (!rawInput) {
          localStorage.removeItem('sortingKeywords');
        } else {
          localStorage.setItem('sortingKeywords', JSON.stringify(updatedConfig.sortingKeywords));
        }

        flushManagedStorageSnapshot();

        if (hasCastPolicyFields && isRealAdmin) {
          updateCastModuleSettings_apply({
            EnableCastModule: updatedConfig.enableCastModule,
            AllowSharedCastViewerForUsers: updatedConfig.allowSharedCastViewerForUsers
          });
        }

        if (isAdmin && hasTmdbApiKeyField) {
          updateJmsPluginConfig({ TmdbApiKey: tmdbApiKey });
        }
        try {
          var watchlistModule = import("../watchlist.js");
          watchlistModule.refreshWatchlistUi.();
        } catch {}
        try {
          window.__jmsRefreshOptionalModules.({ forcePause: true });
        } catch {}
        try { window.__jmsQueueFeatureCssSync.(); } catch {}

        var forcedAdminPublish = !!(cfgGuard.forceGlobalUserSettings && isAdmin);
        var publishResult = { attempted: false, forced: false, ok: true };
        if (!(cfgGuard.forceGlobalUserSettings && !isAdmin)) {
          publishResult = publishAdminSnapshotIfForced();
        }
        updateSlidePosition();
        updateHeaderUserAvatar();
        if (oldTheme !== updatedConfig.playerTheme || oldPlayerStyle !== updatedConfig.playerStyle) {
        loadCSS();
    }

    if (cfgGuard.forceGlobalUserSettings && !isAdmin) {
      showNotification(
        "<i class=\"fas fa-user\" style=\"margin-right:8px;\"></i> " + (cfgGuard.languageLabels.settingsSavedModal || "Suas configurações de avatar/tema foram salvas para este usuário."),
        2500,
        "info"
      );
    }

    var avatarSettingsChanged =
        config.createAvatar !== updatedConfig.createAvatar ||
        config.avatarStyle !== updatedConfig.avatarStyle ||
        config.dicebearStyle !== updatedConfig.dicebearStyle ||
        config.dicebearBackgroundColor !== updatedConfig.dicebearBackgroundColor ||
        config.dicebearRadius !== updatedConfig.dicebearRadius ||
        config.avatarScale !== updatedConfig.avatarScale ||
        config.avatarColorMethod !== updatedConfig.avatarColorMethod ||
        config.avatarSolidColor !== updatedConfig.avatarSolidColor ||
        config.avatarFontFamily !== updatedConfig.avatarFontFamily ||
        config.avatarGradient !== updatedConfig.avatarGradient;

    if (avatarSettingsChanged) {
        console.log("As configurações de avatar mudaram, atualizando agora...");
        clearAvatarCache();
        updateHeaderUserAvatar();
    } else {
        updateAvatarStyles();
    }

    if (!reload) {
      setTimeoutfunction(() {
        try {
          var [
            { ensureStudioHubsMounted },
            { renderPersonalRecommendations },
            { mountDirectorRowsLazy },
            { mountRecentRowsLazy }
          ] = Promise.all([
            import("../studioHubs.js"),
            import("../personalRecommendations.js"),
            import("../directorRows.js"),
            import("../recentRows.js")
          ]);

          try { renderPersonalRecommendations.({ force: true }); } catch {}
          try { mountDirectorRowsLazy.({ force: true }); } catch {}
          try { mountRecentRowsLazy.({ force: true }); } catch {}
          try { ensureStudioHubsMounted.({ eager: true, force: true }); } catch {}
        } catch {}
      }, 0);
    }

    if (forcedAdminPublish && publishResult.attempted && !publishResult.ok) {
      var failText =
        cfgGuard.languageLabels.forceGlobalPublishFailed ||
        "Não foi possível publicar as configurações globais de usuário. A página não foi recarregada.";
      showNotification(
        "<i class=\"fas fa-triangle-exclamation\" style=\"margin-right:8px;\"></i> " + (failText),
        4200,
        "error"
      );
      return {
        ok: false,
        publishResult,
        forcedAdminPublish
      };
    }

    if (reload) location.reload();

    return {
      ok: true,
      publishResult,
      forcedAdminPublish
    };
    }

export function applyRawConfig(config) {
  if (!config || typeof config !== 'object') return;

  Object.entries(config).forEach(function(([key, value]) {
    try {
      if (key === 'settings.allowedTabs.v1') return;
      if (key === 'gradientOverlayImageType') {
        localStorage.removeItem(key);
        return;
      }
      if (typeof value === 'object') {
        localStorage.setItem(key, JSON.stringify(value));
      } else {
        localStorage.setItem(key, String(value));
      }
    } catch (e) {
      console.warn("Não foi possível definir o valor de '" + (key) + "':", e);
    }
  });

  localStorage.removeItem('gradientOverlayImageType');

  updateSlidePosition();

  if (config.playerTheme || config.playerStyle) {
    loadCSS.();
  }

  location.reload();
}
