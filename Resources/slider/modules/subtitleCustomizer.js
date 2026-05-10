import { getConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { faIconHtml } from "./faIcons.js";

var STORAGE_KEY = "jms:subtitleCustomizer:v1";
var JF_APPEARANCE_KEY = "localplayersubtitleappearance3";
var JF_SUBTITLE_BURN_IN_KEY = "subtitleburnin";
var JF_SUBTITLE_RENDER_PGS_KEY = "subtitlerenderpgs";
var JF_ALWAYS_BURN_IN_WHEN_TRANSCODING_KEY = "alwaysBurnInSubtitleWhenTranscoding";
var STYLE_ID = "jms-subtitle-cue-style";
var BTN_CLASS = "btnJmsSubtitleCustomizer";
var DIALOG_ATTR = "data-jms-subtitle-dialog";
var DIALOG_ID = "jms-subtitle-dialog";
var FORCED_BURN_IN_VALUES = new Set(["all", "allcomplexformats", "onlyimageformats"]);

var playbackManagersCache = {
  at: 0,
  list: []
};
var patchedSubtitleAppearancePlayers = new Set();
var patchedSubtitleAppearanceMeta = new WeakMap();
var cachedSubtitleOffsets = new WeakMap();
var originalCueTimings = new WeakMap();
var trackCueTimingSyncState = new WeakMap();
var trackCuePositionSyncState = new WeakMap();
var mirroredSubtitleTrackModes = new Map();

var nativeSubtitleUiOffsetCache = {
  slider: null,
  value: null
};

var config = getConfig();
var labels =
  (typeof getLanguageLabels === "function"
    ? getLanguageLabels(config.defaultLanguage || config.language)
    : null) ||
  (config.languageLabels.[config.language] || null) ||
  config.languageLabels ||
  {};

function L(key, fallback) {
  var value = labels.[key];
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

var DEFAULT_SETTINGS = Object.freeze({
  sizePercent: 110,
  color: "#ffffff",
  colorOpacity: 100,
  fontFamily: "default",
  dropShadow: "",
  shadowColor: "#000000",
  shadowOpacity: 100,
  shadowSize: 7,
  shadowDirection: 135,
  backgroundEnabled: false,
  backgroundColor: "#000000",
  backgroundOpacity: 100,
  backgroundRadiusPx: 6,
  delaySec: 0,
  position: "bottom"
});

var DEFAULT_FONT_STACK = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

var BASE_FONT_OPTIONS = Object.freeze([
  { value: "default", label: L("subtitleCustomizerFontDefault", "Padrão"), jellyfinFont: "" },
  { value: "Courier New,monospace", label: "Typewriter", jellyfinFont: "typewriter" },
  { value: "Georgia,Times New Roman,Arial,Helvetica,serif", label: "Print", jellyfinFont: "print" },
  { value: "Consolas,Lucida Console,Menlo,Monaco,monospace", label: "Console", jellyfinFont: "console" },
  { value: "Lucida Handwriting,Brush Script MT,Segoe Script,cursive", label: "Cursive", jellyfinFont: "cursive" },
  { value: "Gabriola,Segoe Print,Comic Sans MS,Chalkboard,sans-serif", label: "Casual", jellyfinFont: "casual" },
  { value: "Copperplate Gothic,Copperplate,sans-serif", label: "SmallCaps", jellyfinFont: "smallcaps" },
  { value: "Arial,sans-serif", label: "Arial", jellyfinFont: "" },
  { value: "Helvetica,Arial,sans-serif", label: "Helvetica", jellyfinFont: "" },
  { value: "Verdana,Geneva,sans-serif", label: "Verdana", jellyfinFont: "" },
  { value: "Tahoma,Geneva,sans-serif", label: "Tahoma", jellyfinFont: "" },
  { value: "Trebuchet MS,sans-serif", label: "Trebuchet MS", jellyfinFont: "" },
  { value: "Segoe UI,Arial,sans-serif", label: "Segoe UI", jellyfinFont: "" },
  { value: "Roboto,Helvetica,Arial,sans-serif", label: "Roboto", jellyfinFont: "" },
  { value: "Open Sans,Arial,sans-serif", label: "Open Sans", jellyfinFont: "" },
  { value: "Lato,Arial,sans-serif", label: "Lato", jellyfinFont: "" },
  { value: "Montserrat,Arial,sans-serif", label: "Montserrat", jellyfinFont: "" },
  { value: "Poppins,Arial,sans-serif", label: "Poppins", jellyfinFont: "" },
  { value: "Noto Sans,Arial,sans-serif", label: "Noto Sans", jellyfinFont: "" },
  { value: "Ubuntu,Arial,sans-serif", label: "Ubuntu", jellyfinFont: "" },
  { value: "Georgia,serif", label: "Georgia", jellyfinFont: "" },
  { value: "Times New Roman,Times,serif", label: "Times New Roman", jellyfinFont: "" },
  { value: "Palatino Linotype,Book Antiqua,Palatino,serif", label: "Palatino", jellyfinFont: "" },
  { value: "Garamond,serif", label: "Garamond", jellyfinFont: "" },
  { value: "Comic Sans MS,cursive,sans-serif", label: "Comic Sans", jellyfinFont: "" }
]);

var EXTRA_FONT_OPTIONS = Object.freeze([
  { value: "system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif", label: "System UI", jellyfinFont: "" },
  { value: "SF Pro Display,SF Pro Text,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif", label: "SF Pro", jellyfinFont: "" },
  { value: "Avenir Next,Avenir,Segoe UI,Arial,sans-serif", label: "Avenir Next", jellyfinFont: "" },
  { value: "Avenir,Segoe UI,Arial,sans-serif", label: "Avenir", jellyfinFont: "" },
  { value: "Helvetica Neue,Helvetica,Arial,sans-serif", label: "Helvetica Neue", jellyfinFont: "" },
  { value: "Arial Narrow,Arial,sans-serif", label: "Arial Narrow", jellyfinFont: "" },
  { value: "Franklin Gothic Medium,Arial Narrow,Arial,sans-serif", label: "Franklin Gothic", jellyfinFont: "" },
  { value: "Gill Sans,Gill Sans MT,Calibri,Trebuchet MS,sans-serif", label: "Gill Sans", jellyfinFont: "" },
  { value: "Futura,Trebuchet MS,Arial,sans-serif", label: "Futura", jellyfinFont: "" },
  { value: "Optima,Segoe UI,Arial,sans-serif", label: "Optima", jellyfinFont: "" },
  { value: "Didot,Times New Roman,serif", label: "Didot", jellyfinFont: "" },
  { value: "Bodoni MT,Didot,Times New Roman,serif", label: "Bodoni MT", jellyfinFont: "" },
  { value: "Baskerville,Times New Roman,serif", label: "Baskerville", jellyfinFont: "" },
  { value: "Hoefler Text,Baskerville,Times New Roman,serif", label: "Hoefler Text", jellyfinFont: "" },
  { value: "Cambria,Georgia,serif", label: "Cambria", jellyfinFont: "" },
  { value: "Constantia,Georgia,serif", label: "Constantia", jellyfinFont: "" },
  { value: "Corbel,Arial,sans-serif", label: "Corbel", jellyfinFont: "" },
  { value: "Calibri,Arial,sans-serif", label: "Calibri", jellyfinFont: "" },
  { value: "Candara,Arial,sans-serif", label: "Candara", jellyfinFont: "" },
  { value: "Century Gothic,Futura,Arial,sans-serif", label: "Century Gothic", jellyfinFont: "" },
  { value: "Geneva,Verdana,sans-serif", label: "Geneva", jellyfinFont: "" },
  { value: "Lucida Sans,Lucida Grande,Segoe UI,Arial,sans-serif", label: "Lucida Sans", jellyfinFont: "" },
  { value: "Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif", label: "Inter", jellyfinFont: "" },
  { value: "Manrope,Segoe UI,Arial,sans-serif", label: "Manrope", jellyfinFont: "" },
  { value: "DM Sans,Segoe UI,Arial,sans-serif", label: "DM Sans", jellyfinFont: "" },
  { value: "Work Sans,Segoe UI,Arial,sans-serif", label: "Work Sans", jellyfinFont: "" },
  { value: "Nunito,Segoe UI,Arial,sans-serif", label: "Nunito", jellyfinFont: "" },
  { value: "PT Sans,Arial,sans-serif", label: "PT Sans", jellyfinFont: "" },
  { value: "Source Sans 3,Source Sans Pro,Segoe UI,Arial,sans-serif", label: "Source Sans", jellyfinFont: "" },
  { value: "IBM Plex Sans,Segoe UI,Arial,sans-serif", label: "IBM Plex Sans", jellyfinFont: "" },
  { value: "Merriweather,Georgia,serif", label: "Merriweather", jellyfinFont: "" },
  { value: "Playfair Display,Georgia,serif", label: "Playfair Display", jellyfinFont: "" },
  { value: "Bitter,Georgia,serif", label: "Bitter", jellyfinFont: "" },
  { value: "Arvo,Rockwell,Georgia,serif", label: "Arvo", jellyfinFont: "" },
  { value: "Alegreya,Georgia,serif", label: "Alegreya", jellyfinFont: "" },
  { value: "Cormorant Garamond,Garamond,Times New Roman,serif", label: "Cormorant Garamond", jellyfinFont: "" },
  { value: "Source Serif 4,Source Serif Pro,Georgia,serif", label: "Source Serif", jellyfinFont: "" },
  { value: "Noto Serif,Georgia,serif", label: "Noto Serif", jellyfinFont: "" },
  { value: "PT Serif,Georgia,serif", label: "PT Serif", jellyfinFont: "" },
  { value: "Rockwell,Georgia,serif", label: "Rockwell", jellyfinFont: "" },
  { value: "Clarendon,Georgia,serif", label: "Clarendon", jellyfinFont: "" },
  { value: "Inconsolata,Consolas,Menlo,Monaco,monospace", label: "Inconsolata", jellyfinFont: "" },
  { value: "Fira Sans,Segoe UI,Arial,sans-serif", label: "Fira Sans", jellyfinFont: "" },
  { value: "Fira Code,Consolas,Menlo,Monaco,monospace", label: "Fira Code", jellyfinFont: "" },
  { value: "JetBrains Mono,Consolas,Menlo,Monaco,monospace", label: "JetBrains Mono", jellyfinFont: "" },
  { value: "Cascadia Code,Consolas,Menlo,Monaco,monospace", label: "Cascadia Code", jellyfinFont: "" },
  { value: "Source Code Pro,Consolas,Menlo,Monaco,monospace", label: "Source Code Pro", jellyfinFont: "" },
  { value: "Menlo,Consolas,Monaco,monospace", label: "Menlo", jellyfinFont: "" },
  { value: "Monaco,Menlo,Consolas,monospace", label: "Monaco", jellyfinFont: "" },
  { value: "Andale Mono,Consolas,Menlo,Monaco,monospace", label: "Andale Mono", jellyfinFont: "" },
  { value: "Courier Prime,Courier New,monospace", label: "Courier Prime", jellyfinFont: "" },
  { value: "Ubuntu Mono,Consolas,Menlo,Monaco,monospace", label: "Ubuntu Mono", jellyfinFont: "" },
  { value: "IBM Plex Mono,Consolas,Menlo,Monaco,monospace", label: "IBM Plex Mono", jellyfinFont: "" },
  { value: "Cabin,Segoe UI,Arial,sans-serif", label: "Cabin", jellyfinFont: "" },
  { value: "Raleway,Segoe UI,Arial,sans-serif", label: "Raleway", jellyfinFont: "" },
  { value: "Oswald,Arial Narrow,Arial,sans-serif", label: "Oswald", jellyfinFont: "" },
  { value: "Bebas Neue,Impact,Arial Narrow,sans-serif", label: "Bebas Neue", jellyfinFont: "" },
  { value: "Quicksand,Segoe UI,Arial,sans-serif", label: "Quicksand", jellyfinFont: "" },
  { value: "Josefin Sans,Segoe UI,Arial,sans-serif", label: "Josefin Sans", jellyfinFont: "" },
  { value: "Exo 2,Segoe UI,Arial,sans-serif", label: "Exo 2", jellyfinFont: "" },
  { value: "Rubik,Segoe UI,Arial,sans-serif", label: "Rubik", jellyfinFont: "" },
  { value: "Segoe Print,Segoe Script,Comic Sans MS,cursive,sans-serif", label: "Segoe Print", jellyfinFont: "" },
  { value: "Bradley Hand,Segoe Print,Comic Sans MS,cursive", label: "Bradley Hand", jellyfinFont: "" },
  { value: "Chalkboard SE,Chalkboard,Comic Sans MS,cursive", label: "Chalkboard", jellyfinFont: "" },
  { value: "Marker Felt,Comic Sans MS,cursive", label: "Marker Felt", jellyfinFont: "" },
  { value: "Papyrus,Marker Felt,Comic Sans MS,fantasy", label: "Papyrus", jellyfinFont: "" }
]);

var SUBTITLE_BACKGROUND_PADDING = "0.04em 0.24em";
var PREVIEW_BACKGROUND_PADDING = "0.05em 0.3em";
var MIN_BACKGROUND_RADIUS_PX = 0;
var MAX_BACKGROUND_RADIUS_PX = 32;
var SUBTITLE_MUTATION_SELECTOR = [
  ".videoPlayerContainer",
  ".videoOsdBottom.videoOsdBottom-maincontrols",
  ".videoOsdBottom.videoOsdBottom-maincontrols .buttons",
  ".btnSubtitles",
  "." + (BTN_CLASS),
  ".videoSubtitles",
  ".videoSubtitlesInner",
  ".videoSecondarySubtitlesInner",
  ".libassjs-canvas-parent",
  "canvas.libassjs-canvas",
  "video.htmlvideoplayer",
  "video"
].join(",");
var SUBTITLE_HEAVY_MUTATION_SELECTOR = [
  ".videoPlayerContainer",
  ".libassjs-canvas-parent",
  "canvas.libassjs-canvas",
  "video.htmlvideoplayer",
  "video"
].join(",");
var FONT_SIGNATURE_SAMPLES = Object.freeze([
  "Sphinx of black quartz, judge my vow 0123456789",
  "Il1 O0 mwMW @#%& [] {} ()",
  "The quick brown fox jumps over the lazy dog"
]);

var fontOptionsCache = null;
var fontAliasesCache = null;
var fontMeasureContextCache = null;

function getFontOptions() {
  if (fontOptionsCache) return fontOptionsCache;

  var out = [];
  var seen = new Set();
  var aliases = new Map();
  var signatureOwners = new Map();
  var measureContext = getFontMeasureContext();
  var add = function(option) {
    if (!option || typeof option !== "object") return;
    var value = String(option.value || "").trim();
    if (!value || seen.has(value)) return;
    if (value !== DEFAULT_SETTINGS.fontFamily && measureContext) {
      var signature = getFontRenderSignature(value, measureContext);
      var existingValue = signatureOwners.get(signature);
      if (existingValue) {
        aliases.set(value, existingValue);
        return;
      }
      signatureOwners.set(signature, value);
    }
    seen.add(value);
    out.push(option);
  };

  BASE_FONT_OPTIONS.forEach(add);
  EXTRA_FONT_OPTIONS.forEach(add);

  fontAliasesCache = aliases;
  fontOptionsCache = Object.freeze(out.length ? out : BASE_FONT_OPTIONS.slice());
  return fontOptionsCache;
}

function getFontMeasureContext() {
  if (fontMeasureContextCache) return fontMeasureContextCache;
  if (typeof document === "undefined") return null;

  try {
    var canvas = document.createElement("canvas");
    fontMeasureContextCache = canvas.getContext("2d");
  } catch {
    fontMeasureContextCache = null;
  }

  return fontMeasureContextCache;
}

function getFontRenderSignature(fontStack, context) {
  if (!context) return String(fontStack || "").trim();

  var safeFontStack = formatFontStack(fontStack);
  if (!safeFontStack) return "";

  var parts = [];
  FONT_SIGNATURE_SAMPLES.forEach(function((sample) {
    try {
      context.font = "72px " + (safeFontStack);
      var metrics = context.measureText(sample);
      parts.push((Math.round(metrics.width * 100) / 100).toFixed(2));
      if (Number.isFinite(metrics.actualBoundingBoxAscent)) {
        parts.push((Math.round(metrics.actualBoundingBoxAscent * 100) / 100).toFixed(2));
      }
      if (Number.isFinite(metrics.actualBoundingBoxDescent)) {
        parts.push((Math.round(metrics.actualBoundingBoxDescent * 100) / 100).toFixed(2));
      }
    } catch {
      parts.push(sample.length.toString());
    }
  });

  return parts.join("|");
}

function normalizeFontFamilySelection(value, fallback = DEFAULT_SETTINGS.fontFamily) {
  var fontOptions = getFontOptions();
  var aliases = fontAliasesCache || new Map();
  var selected = String(value || "").trim();
  var canonical = aliases.get(selected) || selected;
  var fallbackValue = String(fallback || DEFAULT_SETTINGS.fontFamily).trim();
  var canonicalFallback = aliases.get(fallbackValue) || fallbackValue || DEFAULT_SETTINGS.fontFamily;
  return fontOptions.somefunction((opt) opt.value === canonical)
    ? canonical
    : function(fontOptions.some((opt) opt.value === canonicalFallback)
        ? canonicalFallback
        : DEFAULT_SETTINGS.fontFamily);
}

function formatFontFamilyToken(token) {
  var family = String(token || "").trim();
  if (!family) return "";
  if (/^["'].*["']$/.test(family)) return family;
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i.test(family)) {
    return family;
  }
  return "\"" + (family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')) + "\"";
}

function formatFontStack(fontStack) {
  return String(fontStack || "")
    .split(",")
    .mapfunction((part) formatFontFamilyToken(part))
    .filter(Boolean)
    .join(",");
}

var SHADOW_OPTIONS = Object.freeze([
  { value: "", label: L("subtitleCustomizerShadowDefault", "Padrão") },
  { value: "none", label: L("subtitleCustomizerShadowNone", "Nenhum") },
  { value: "uniform", label: L("subtitleCustomizerShadowUniform", "Uniform") },
  { value: "raised", label: L("subtitleCustomizerShadowRaised", "Alto relevo") },
  { value: "depressed", label: L("subtitleCustomizerShadowDepressed", "Baixo relevo") }
]);

var POSITION_VALUES = Object.freeze(["bottom", "center", "top"]);

function clampNumber(value, min, max, fallback) {
  var num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function normalizeHexColor(raw, fallback) {
  var val = String(raw || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(val)) return val;
  if (/^#[0-9a-f]{3}$/.test(val)) {
    return "#" + (val[1]) + (val[1]) + (val[2]) + (val[2]) + (val[3]) + (val[3]);
  }
  return fallback;
}

function normalizeColor(raw) {
  return normalizeHexColor(raw, DEFAULT_SETTINGS.color);
}

function normalizeOpacity(raw, fallback = 100) {
  return Math.round(clampNumber(raw, 0, 100, fallback));
}

function normalizeColorOpacity(raw) {
  return normalizeOpacity(raw, DEFAULT_SETTINGS.colorOpacity);
}

function normalizeShadowColor(raw) {
  return normalizeHexColor(raw, DEFAULT_SETTINGS.shadowColor);
}

function normalizeShadowOpacity(raw) {
  return normalizeOpacity(raw, DEFAULT_SETTINGS.shadowOpacity);
}

function normalizeBackgroundColor(raw) {
  return normalizeHexColor(raw, DEFAULT_SETTINGS.backgroundColor);
}

function normalizeBackgroundOpacity(raw) {
  return normalizeOpacity(raw, DEFAULT_SETTINGS.backgroundOpacity);
}

function normalizeBackgroundEnabled(raw) {
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

function normalizeBackgroundRadius(raw) {
  return Math.round(
    clampNumber(raw, MIN_BACKGROUND_RADIUS_PX, MAX_BACKGROUND_RADIUS_PX, DEFAULT_SETTINGS.backgroundRadiusPx)
  );
}

function getBackgroundRadiusCssValue(settings) {
  return (normalizeBackgroundRadius(settings.backgroundRadiusPx)) + "px";
}

function formatDelayValue(delaySec) {
  var normalized =
    Math.round(clampNumber(delaySec, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;
  return (normalized.toFixed(1)) + "s";
}

function normalizeDelaySeconds(delaySec) {
  return Math.round(clampNumber(delaySec, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;
}

function normalizeDropShadow(raw) {
  var val = String(raw || "").trim().toLowerCase();
  return SHADOW_OPTIONS.somefunction((item) item.value === val) ? val : DEFAULT_SETTINGS.dropShadow;
}

function normalizeShadowSize(raw) {
  return Math.round(clampNumber(raw, 0, 24, DEFAULT_SETTINGS.shadowSize));
}

function normalizeShadowDirection(raw) {
  var n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.shadowDirection;
  var normalized = ((Math.round(n) % 360) + 360) % 360;
  return normalized;
}

function parseCssColorValue(raw, fallbackHex, fallbackOpacity = 100) {
  var safeFallbackHex = normalizeHexColor(fallbackHex, DEFAULT_SETTINGS.color);
  var safeFallbackOpacity = normalizeOpacity(fallbackOpacity, 100);
  var val = String(raw || "").trim().toLowerCase();

  if (!val) {
    return {
      hex: safeFallbackHex,
      opacity: safeFallbackOpacity
    };
  }

  if (val === "transparent" || val === "none") return null;

  if (/^#[0-9a-f]{8}$/.test(val)) {
    return {
      hex: "#" + (val.slice(1, 7)),
      opacity: normalizeOpacity((parseInt(val.slice(7, 9), 16) / 255) * 100, 100)
    };
  }

  if (/^#[0-9a-f]{4}$/.test(val)) {
    return {
      hex: "#" + (val[1]) + (val[1]) + (val[2]) + (val[2]) + (val[3]) + (val[3]),
      opacity: normalizeOpacity((parseInt((val[4]) + (val[4]), 16) / 255) * 100, 100)
    };
  }

  var normalizedHex = normalizeHexColor(val, "");
  if (normalizedHex) {
    return {
      hex: normalizedHex,
      opacity: 100
    };
  }

  var match = val.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    return {
      hex: safeFallbackHex,
      opacity: safeFallbackOpacity
    };
  }

  var body = match[1].trim();
  var parts = [];
  var alphaPart = "";
  if (body.includes(",")) {
    var pieces = body.split(",").mapfunction((v) v.trim()).filter(Boolean);
    parts = pieces.slice(0, 3);
    alphaPart = pieces[3] || "";
  } else {
    var [rgbPart, alphaRaw = ""] = body.split("/").mapfunction((v) v.trim());
    parts = String(rgbPart || "").split(/\s+/).filter(Boolean).slice(0, 3);
    alphaPart = alphaRaw;
  }

  if (parts.length < 3) {
    return {
      hex: safeFallbackHex,
      opacity: safeFallbackOpacity
    };
  }

  var rgb = [];
  for (var i = 0; i < 3; i++) {
    var n = Number(parts[i].replace("%", ""));
    if (!Number.isFinite(n)) {
      return {
        hex: safeFallbackHex,
        opacity: safeFallbackOpacity
      };
    }
    var normalized = parts[i].includes("%")
      ? Math.round((n / 100) * 255)
      : Math.round(n);
    rgb.push(Math.max(0, Math.min(255, normalized)));
  }

  var opacity = 100;
  if (alphaPart) {
    var alphaValue = alphaPart.includes("%")
      ? Number(alphaPart.replace("%", "")) / 100
      : Number(alphaPart);
    if (Number.isFinite(alphaValue)) {
      opacity = normalizeOpacity(alphaValue * 100, 100);
    }
  }

  return {
    hex: "#" + (rgb.mapfunction((v) v.toString(16).padStart(2, "0")).join("")),
    opacity
  };
}

function parseBackgroundFromJellyfin(raw) {
  var parsed = parseCssColorValue(
    raw,
    DEFAULT_SETTINGS.backgroundColor,
    DEFAULT_SETTINGS.backgroundOpacity
  );
  if (!parsed) {
    return {
      backgroundEnabled: false,
      backgroundColor: DEFAULT_SETTINGS.backgroundColor,
      backgroundOpacity: DEFAULT_SETTINGS.backgroundOpacity
    };
  }
  return {
    backgroundEnabled: true,
    backgroundColor: normalizeBackgroundColor(parsed.hex),
    backgroundOpacity: normalizeBackgroundOpacity(parsed.opacity)
  };
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getFontOptionByValue(value) {
  var selected = normalizeFontFamilySelection(value);
  var fontOptions = getFontOptions();
  return fontOptions.findfunction((opt) opt.value === selected) || fontOptions[0];
}

function getCurrentUserIdCandidates() {
  var ids = [];
  var add = function(value) {
    var val = String(value || "").trim();
    if (!val || ids.includes(val)) return;
    ids.push(val);
  };

  try {
    add(window.ApiClient.getCurrentUserId.());
  } catch {}

  try {
    add(window.MediaBrowser.ApiClient.getCurrentUserId.());
  } catch {}

  try {
    add(window.MediaBrowser.ApiClient._currentUser.Id);
  } catch {}

  return ids;
}

function getPreferredAppearanceKeys() {
  var keys = [];
  var seen = new Set();
  var add = function(value) {
    var key = String(value || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  var userIds = getCurrentUserIdCandidates();
  userIds.forEach(function((userId) add((userId) + "-" + (JF_APPEARANCE_KEY)));

  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (typeof key === "string" && key.endsWith("-" + (JF_APPEARANCE_KEY))) {
        add(key);
      }
    }
  } catch {}

  add(JF_APPEARANCE_KEY);
  return keys;
}

function getDefaultSettingsFromJellyfin() {
  var { data: jf } = loadJellyfinAppearance();
  var text = parseCssColorValue(jf.textColor, DEFAULT_SETTINGS.color, DEFAULT_SETTINGS.colorOpacity);
  var bg = parseBackgroundFromJellyfin(jf.textBackground);
  return {
    sizePercent: jellyfinTextSizeToPercent(jf.textSize),
    color: normalizeColor(text.hex || DEFAULT_SETTINGS.color),
    colorOpacity: normalizeColorOpacity(text.opacity || DEFAULT_SETTINGS.colorOpacity),
    fontFamily: jellyfinFontToFamily(jf.font),
    dropShadow: normalizeDropShadow(jf.dropShadow),
    shadowColor: DEFAULT_SETTINGS.shadowColor,
    shadowOpacity: DEFAULT_SETTINGS.shadowOpacity,
    shadowSize: DEFAULT_SETTINGS.shadowSize,
    shadowDirection: DEFAULT_SETTINGS.shadowDirection,
    backgroundEnabled: bg.backgroundEnabled,
    backgroundColor: bg.backgroundColor,
    backgroundOpacity: bg.backgroundOpacity,
    backgroundRadiusPx: DEFAULT_SETTINGS.backgroundRadiusPx,
    position: jellyfinVerticalToPosition(jf.verticalPosition)
  };
}

function loadSettings() {
  var fallback = getDefaultSettingsFromJellyfin();

  try {
    var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    var selectedFont = normalizeFontFamilySelection(parsed.fontFamily, fallback.fontFamily);
    var dropShadow = normalizeDropShadow(parsed.dropShadow || fallback.dropShadow);
    var colorOpacity = normalizeColorOpacity(parsed.colorOpacity || fallback.colorOpacity);
    var shadowColor = normalizeShadowColor(parsed.shadowColor || fallback.shadowColor);
    var shadowOpacity = normalizeShadowOpacity(parsed.shadowOpacity || fallback.shadowOpacity);
    var shadowSize = normalizeShadowSize(parsed.shadowSize || fallback.shadowSize);
    var shadowDirection = normalizeShadowDirection(parsed.shadowDirection || fallback.shadowDirection);
    var backgroundEnabled = normalizeBackgroundEnabled(
      parsed.backgroundEnabled || fallback.backgroundEnabled
    );
    var backgroundColor = normalizeBackgroundColor(parsed.backgroundColor || fallback.backgroundColor);
    var backgroundOpacity = normalizeBackgroundOpacity(
      parsed.backgroundOpacity || fallback.backgroundOpacity
    );
    var backgroundRadiusPx = normalizeBackgroundRadius(
      parsed.backgroundRadiusPx || fallback.backgroundRadiusPx
    );

    return {
      sizePercent: Math.round(clampNumber(parsed.sizePercent, 60, 220, fallback.sizePercent || DEFAULT_SETTINGS.sizePercent)),
      color: normalizeColor(parsed.color || fallback.color),
      colorOpacity,
      fontFamily: selectedFont,
      dropShadow,
      shadowColor,
      shadowOpacity,
      shadowSize,
      shadowDirection,
      backgroundEnabled,
      backgroundColor,
      backgroundOpacity,
      backgroundRadiusPx,
      delaySec: DEFAULT_SETTINGS.delaySec,
      position: fallback.position
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      ...fallback
    };
  }
}

function getPersistentSettingsPayload(settings) {
  return {
    sizePercent: Math.round(clampNumber(settings.sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent)),
    color: normalizeColor(settings.color || DEFAULT_SETTINGS.color),
    colorOpacity: normalizeColorOpacity(settings.colorOpacity),
    fontFamily: normalizeFontFamilySelection(settings.fontFamily, DEFAULT_SETTINGS.fontFamily),
    dropShadow: normalizeDropShadow(settings.dropShadow),
    shadowColor: normalizeShadowColor(settings.shadowColor),
    shadowOpacity: normalizeShadowOpacity(settings.shadowOpacity),
    shadowSize: normalizeShadowSize(settings.shadowSize),
    shadowDirection: normalizeShadowDirection(settings.shadowDirection),
    backgroundEnabled: normalizeBackgroundEnabled(settings.backgroundEnabled),
    backgroundColor: normalizeBackgroundColor(settings.backgroundColor),
    backgroundOpacity: normalizeBackgroundOpacity(settings.backgroundOpacity),
    backgroundRadiusPx: normalizeBackgroundRadius(settings.backgroundRadiusPx)
  };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistentSettingsPayload(settings)));
  } catch {}
}

function setLocalStorageIfChanged(key, value) {
  try {
    var next = String(value);
    if (localStorage.getItem(key) !== next) {
      localStorage.setItem(key, next);
      return true;
    }
  } catch {}
  return false;
}

function ensureClientSubtitleRenderingPreferences() {
  var changed = false;

  changed = setLocalStorageIfChanged(JF_SUBTITLE_RENDER_PGS_KEY, "true") || changed;

  try {
    var burnIn = String(localStorage.getItem(JF_SUBTITLE_BURN_IN_KEY) || "")
      .trim()
      .toLowerCase();
    if (FORCED_BURN_IN_VALUES.has(burnIn)) {
      changed = setLocalStorageIfChanged(JF_SUBTITLE_BURN_IN_KEY, "") || changed;
    }
  } catch {}

  try {
    var alwaysBurn = String(localStorage.getItem(JF_ALWAYS_BURN_IN_WHEN_TRANSCODING_KEY) || "")
      .trim()
      .toLowerCase();
    if (alwaysBurn === "true" || alwaysBurn === "1") {
      changed = setLocalStorageIfChanged(JF_ALWAYS_BURN_IN_WHEN_TRANSCODING_KEY, "false") || changed;
    }
  } catch {}

  return changed;
}

function loadJellyfinAppearance() {
  var keys = getPreferredAppearanceKeys();
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    try {
      var raw = localStorage.getItem(key);
      if (!raw) continue;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { data: parsed, key };
      }
    } catch {}
  }
  return { data: {}, key: keys[0] || JF_APPEARANCE_KEY };
}

function jellyfinTextSizeToPercent(textSize) {
  switch (String(textSize || "")) {
    case "smaller":
      return 80;
    case "small":
      return 95;
    case "large":
      return 145;
    case "larger":
      return 175;
    case "extralarge":
      return 205;
    default:
      return DEFAULT_SETTINGS.sizePercent;
  }
}

function percentToJellyfinTextSize(sizePercent) {
  var n = clampNumber(sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent);
  if (n <= 82) return "smaller";
  if (n <= 102) return "small";
  if (n <= 130) return "";
  if (n <= 160) return "large";
  if (n <= 190) return "larger";
  return "extralarge";
}

function jellyfinVerticalToPosition(verticalPosition) {
  var n = parseInt(verticalPosition, 10);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.position;
  if (n <= -2) return "bottom";
  if (n >= 2) return "top";
  return "center";
}

function positionToJellyfinVertical(position) {
  if (position === "top") return 3;
  if (position === "center") return 0;
  return -3;
}

function jellyfinFontToFamily(fontToken) {
  var token = String(fontToken || "").toLowerCase();
  if (!token) return DEFAULT_SETTINGS.fontFamily;
  var hit = getFontOptions().findfunction((opt) opt.jellyfinFont === token);
  return hit ? hit.value : DEFAULT_SETTINGS.fontFamily;
}

function resolveFontStack(settings) {
  if (!settings || settings.fontFamily === "default") {
    return DEFAULT_FONT_STACK;
  }
  return formatFontStack(settings.fontFamily);
}

function hexToRgb(hex) {
  var normalized = normalizeHexColor(hex, DEFAULT_SETTINGS.shadowColor);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  };
}

function mixHex(colorA, colorB, ratio) {
  var a = hexToRgb(colorA);
  var b = hexToRgb(colorB);
  var r = Math.max(0, Math.min(1, Number(ratio)));
  var c = {
    r: Math.round(a.r * (1 - r) + b.r * r),
    g: Math.round(a.g * (1 - r) + b.g * r),
    b: Math.round(a.b * (1 - r) + b.b * r)
  };
  return "#" + (c.r.toString(16).padStart(2, "0")) + (c.g.toString(16).padStart(2, "0")) + (c.b.toString(16).padStart(2, "0"));
}

function opacityPercentToAlpha(raw, fallback = 100) {
  return Math.round((normalizeOpacity(raw, fallback) / 100) * 1000) / 1000;
}

function getCssColorValue(raw, opacity, fallbackHex) {
  var normalizedFallback = normalizeHexColor(fallbackHex, DEFAULT_SETTINGS.color);
  var normalizedHex = normalizeHexColor(raw, normalizedFallback);
  var alpha = opacityPercentToAlpha(opacity, 100);
  if (alpha >= 1) return normalizedHex;
  var { r, g, b } = hexToRgb(normalizedHex);
  return "rgba(" + (r) + ", " + (g) + ", " + (b) + ", " + (alpha) + ")";
}

function getTextColorValue(settings) {
  return getCssColorValue(settings.color, settings.colorOpacity, DEFAULT_SETTINGS.color);
}

function getBackgroundColorValue(settings) {
  return settings.backgroundEnabled
    ? getCssColorValue(
      settings.backgroundColor,
      settings.backgroundOpacity,
      DEFAULT_SETTINGS.backgroundColor
    )
    : "transparent";
}

function formatPx(value) {
  var n = Number(value);
  if (!Number.isFinite(n)) return "0px";
  var rounded = Math.round(n * 100) / 100;
  return (rounded) + "px";
}

function getShadowVector(sizePx, directionDeg) {
  var size = normalizeShadowSize(sizePx);
  var dir = normalizeShadowDirection(directionDeg);
  var rad = (dir * Math.PI) / 180;
  var distance = size * 0.42;
  var blur = size;
  return {
    size,
    x: Math.cos(rad) * distance,
    y: Math.sin(rad) * distance,
    blur
  };
}

function getTextShadowValue(dropShadow, shadowColor, shadowSize, shadowDirection, shadowOpacity) {
  var base = normalizeShadowColor(shadowColor);
  var light = mixHex(base, "#ffffff", 0.58);
  var dark = mixHex(base, "#000000", 0.42);
  var vector = getShadowVector(shadowSize, shadowDirection);
  var shadowAlpha = opacityPercentToAlpha(shadowOpacity, DEFAULT_SETTINGS.shadowOpacity);
  var baseColor = getCssColorValue(base, shadowOpacity, DEFAULT_SETTINGS.shadowColor);
  var lightColor = getCssColorValue(light, shadowOpacity, light);
  var darkColor = getCssColorValue(dark, shadowOpacity, dark);
  var mainX = formatPx(vector.x);
  var mainY = formatPx(vector.y);
  var invX = formatPx(-vector.x);
  var invY = formatPx(-vector.y);
  var mainBlur = formatPx(vector.blur);
  var subtleBlur = formatPx(Math.max(0, vector.blur * 0.16));

  if (vector.size <= 0 || shadowAlpha <= 0) {
    return "none";
  }

  switch (normalizeDropShadow(dropShadow)) {
    case "raised":
      return (invX) + " " + (invY) + " " + (subtleBlur) + " " + (lightColor) + ", " + (mainX) + " " + (mainY) + " " + (subtleBlur) + " " + (darkColor);
    case "depressed":
      return (mainX) + " " + (mainY) + " " + (subtleBlur) + " " + (lightColor) + ", " + (invX) + " " + (invY) + " " + (subtleBlur) + " " + (darkColor);
    case "uniform": {
      var r = Math.max(0.8, vector.size * 0.34);
      var ring = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]
      ].mapfunction(([dx, dy]) (formatPx(dx * r)) + " " + (formatPx(dy * r)) + " " + (formatPx(Math.max(0, vector.blur * 0.12))) + " " + (baseColor));
      ring.push((mainX) + " " + (mainY) + " " + (formatPx(Math.max(0, vector.blur * 0.55))) + " " + (baseColor));
      return ring.join(", ");
    }
    case "none":
      return "none";
    default:
      return (mainX) + " " + (mainY) + " " + (mainBlur) + " " + (baseColor);
  }
}

function saveJellyfinAppearance(settings, options = null) {
  var appearanceEntry = loadJellyfinAppearance();
  var current = appearanceEntry.data || {};
  var selectedFont = getFontOptionByValue(settings.fontFamily);
  var currentStyling = String(current.subtitleStyling || "").toLowerCase();
  var suppressComplexTextSize = options.suppressComplexTextSize === true;
  var textColor = getTextColorValue(settings);
  var textBackground = getBackgroundColorValue(settings);
  var next = {
    ...current,
    subtitleStyling: currentStyling === "native" ? "Custom" : (current.subtitleStyling || "Custom"),
    textSize: suppressComplexTextSize ? "" : percentToJellyfinTextSize(settings.sizePercent),
    textWeight: current.textWeight || "normal",
    dropShadow: normalizeDropShadow(settings.dropShadow),
    font: selectedFont.jellyfinFont || "",
    textBackground,
    textColor
  };

  var keys = getPreferredAppearanceKeys();
  var primaryKey = appearanceEntry.key || keys[0] || JF_APPEARANCE_KEY;
  if (!keys.includes(primaryKey)) {
    keys.unshift(primaryKey);
  }

  var nextSerialized = JSON.stringify(next);
  keys.forEach(function((key) {
    try {
      var currentSerialized = localStorage.getItem(key) || "";
      if (nextSerialized !== currentSerialized) {
        localStorage.setItem(key, nextSerialized);
      }
    } catch {}
  });
}

function ensureCueStyleElement() {
  var style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  return style;
}

function applyCueCss(settings) {
  var fontStack = resolveFontStack(settings);
  var textShadow = getTextShadowValue(
    settings.dropShadow,
    settings.shadowColor,
    settings.shadowSize,
    settings.shadowDirection,
    settings.shadowOpacity
  );
  var textColor = getTextColorValue(settings);
  var textBackground = getBackgroundColorValue(settings);
  var backgroundRadius = getBackgroundRadiusCssValue(settings);
  var backgroundPadding = settings.backgroundEnabled ? SUBTITLE_BACKGROUND_PADDING : "0";
  var subtitleDisplay = settings.backgroundEnabled ? "block" : "inline";
  var subtitleWidth = settings.backgroundEnabled ? "fit-content" : "auto";
  var subtitleMaxWidth = settings.backgroundEnabled ? "calc(100% - 1.8em)" : "100%";
  var style = ensureCueStyleElement();
  var lines = [];

  lines.push("html body .videoPlayerContainer video.htmlvideoplayer::cue, html body .videoPlayerContainer .htmlvideoplayer::cue, html body video::cue {");
  lines.push("  color: " + (textColor) + " !important;");
  lines.push("  font-size: " + (settings.sizePercent) + "% !important;");
  lines.push("  font-family: " + (fontStack) + " !important;");
  lines.push("  text-shadow: " + (textShadow) + " !important;");
  lines.push("  background-color: " + (textBackground) + " !important;");
  lines.push("}");

  lines.push(".videoSubtitlesInner, .videoSecondarySubtitlesInner {");
  lines.push("  color: " + (textColor) + " !important;");
  lines.push("  font-size: " + (settings.sizePercent) + "% !important;");
  lines.push("  font-family: " + (fontStack) + " !important;");
  lines.push("  text-shadow: " + (textShadow) + " !important;");
  lines.push("  background-color: " + (textBackground) + " !important;");
  lines.push("  padding: " + (backgroundPadding) + " !important;");
  lines.push("  border-radius: " + (backgroundRadius) + " !important;");
  lines.push("  display: " + (subtitleDisplay) + " !important;");
  lines.push("  width: " + (subtitleWidth) + " !important;");
  lines.push("  max-width: " + (subtitleMaxWidth) + " !important;");
  lines.push("  margin-left: auto !important;");
  lines.push("  margin-right: auto !important;");
  lines.push("  box-decoration-break: " + (settings.backgroundEnabled ? "clone" : "slice") + " !important;");
  lines.push("  -webkit-box-decoration-break: " + (settings.backgroundEnabled ? "clone" : "slice") + " !important;");
  lines.push("  background-clip: padding-box !important;");
  lines.push("  line-height: 1.3 !important;");
  lines.push("  text-align: center;");
  lines.push("  overflow-wrap: anywhere;");
  lines.push("}");

  lines.push(".videoSubtitles {");
  lines.push("  width: 100% !important;");
  lines.push("  left: 0 !important;");
  lines.push("  right: 0 !important;");
  lines.push("  pointer-events: none !important;");
  lines.push("  text-align: center !important;");
  lines.push("}");

  style.textContent = lines.join("\n");
  try {
    (document.head || document.documentElement).appendChild(style);
  } catch {}
}

function patchExistingCueStyles(settings) {
  var fontStack = resolveFontStack(settings);
  var textShadow = getTextShadowValue(
    settings.dropShadow,
    settings.shadowColor,
    settings.shadowSize,
    settings.shadowDirection,
    settings.shadowOpacity
  );
  var textColor = getTextColorValue(settings);
  var textBackground = getBackgroundColorValue(settings);
  var css = [
    ".htmlvideoplayer::cue, video::cue {",
    "  color: " + (textColor) + " !important;",
    "  font-size: " + (settings.sizePercent) + "% !important;",
    "  font-family: " + (fontStack) + " !important;",
    "  text-shadow: " + (textShadow) + " !important;",
    "  background-color: " + (textBackground) + " !important;",
    "}"
  ].join("\n");

  document.querySelectorAll("style[id$='-cuestyle']").forEach(function((styleNode) {
    if (!(styleNode instanceof HTMLStyleElement)) return;
    styleNode.textContent = css;
  });
}

function getLiveSubtitleCustomizerSettings(fallback = null) {
  try {
    var live = window.__jmsSubtitleCustomizerState.settings;
    if (live && typeof live === "object") {
      return {
        ...DEFAULT_SETTINGS,
        ...live
      };
    }
  } catch {}

  if (fallback && typeof fallback === "object") {
    return {
      ...DEFAULT_SETTINGS,
      ...fallback
    };
  }

  return loadSettings();
}

function setElementStyle(node, prop, value, priority = "") {
  if (!(node instanceof HTMLElement)) return;
  var normalizedPriority = priority === "important" ? "important" : "";
  if (value === null || value === undefined || value === "") {
    if (!node.style.getPropertyValue(prop)) return;
    node.style.removeProperty(prop);
    return;
  }
  var nextValue = String(value);
  if (
    node.style.getPropertyValue(prop) === nextValue &&
    node.style.getPropertyPriority(prop) === normalizedPriority
  ) {
    return;
  }
  node.style.setProperty(prop, nextValue, normalizedPriority);
}

function nodeMatchesSubtitleMutationSelector(node, selector, includeDescendants = true) {
  if (!(node instanceof Element)) return false;

  try {
    if (node.matches(selector)) return true;
  } catch {}

  if (!includeDescendants) return false;

  try {
    return !!node.querySelector(selector);
  } catch {
    return false;
  }
}

function nodeListContainsSubtitleMutationTarget(nodeList, selector) {
  for (var i = 0; i < nodeList.length; i++) {
    if (nodeMatchesSubtitleMutationSelector(nodeList[i], selector)) {
      return true;
    }
  }
  return false;
}

function mutationTouchesOnlyTextNodes(mutation) {
  var touchedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return touchedNodes.length > 0 && touchedNodes.everyfunction((node) node.nodeType === Node.TEXT_NODE);
}

function isRelevantSubtitleMutation(mutations) {
  for (var i = 0; i < mutations.length; i++) {
    var mutation = mutations[i];
    if (mutation.type === "attributes") {
      if (nodeMatchesSubtitleMutationSelector(mutation.target, SUBTITLE_MUTATION_SELECTOR, false)) {
        return true;
      }
      continue;
    }

    if (mutation.type !== "childList") continue;

    if (
      mutationTouchesOnlyTextNodes(mutation) &&
      mutation.target instanceof Element &&
      mutation.target.matches(".videoSubtitlesInner, .videoSecondarySubtitlesInner")
    ) {
      continue;
    }

    if (
      nodeListContainsSubtitleMutationTarget(mutation.addedNodes, SUBTITLE_MUTATION_SELECTOR) ||
      nodeListContainsSubtitleMutationTarget(mutation.removedNodes, SUBTITLE_MUTATION_SELECTOR) ||
      nodeMatchesSubtitleMutationSelector(mutation.target, SUBTITLE_MUTATION_SELECTOR, false)
    ) {
      return true;
    }
  }

  return false;
}

function mutationNeedsHeavyRefresh(mutations) {
  for (var i = 0; i < mutations.length; i++) {
    var mutation = mutations[i];
    if (mutation.type !== "childList") continue;
    if (
      nodeListContainsSubtitleMutationTarget(mutation.addedNodes, SUBTITLE_HEAVY_MUTATION_SELECTOR) ||
      nodeListContainsSubtitleMutationTarget(mutation.removedNodes, SUBTITLE_HEAVY_MUTATION_SELECTOR)
    ) {
      return true;
    }
  }

  return false;
}

function getSubtitleMirrorElements(video = null) {
  var playerContainer =
    video.closest.(".videoPlayerContainer") ||
    document.querySelector(".videoPlayerContainer");
  if (!(playerContainer instanceof HTMLElement)) {
    return {
      container: null,
      text: null,
      playerContainer: null
    };
  }

  var container = playerContainer.querySelector(".videoSubtitles[data-jms-subtitle-mirror='1']");
  var text = container.querySelector.(".videoSubtitlesInner");

  if (!(container instanceof HTMLElement) || !(text instanceof HTMLElement)) {
    container = null;
    text = null;
  }

  return {
    container,
    text,
    playerContainer
  };
}

function removeForeignSubtitleMirrors(playerContainer = null) {
  document
    .querySelectorAll(".videoSubtitles[data-jms-subtitle-mirror='1']")
    .forEach(function((node) {
      if (!(node instanceof HTMLElement)) return;
      if (playerContainer instanceof HTMLElement && node.parentElement === playerContainer) return;
      node.remove();
    });
}

function ensureSubtitleMirror(video) {
  var refs = getSubtitleMirrorElements(video);
  if (refs.playerContainer instanceof HTMLElement) {
    removeForeignSubtitleMirrors(refs.playerContainer);
  }
  if (refs.container && refs.text) return refs;
  if (!(refs.playerContainer instanceof HTMLElement)) return refs;

  var container = document.createElement("div");
  container.className = "videoSubtitles";
  container.dataset.jmsSubtitleMirror = "1";

  var text = document.createElement("div");
  text.className = "videoSubtitlesInner";
  text.dataset.jmsSubtitleMirror = "1";
  text.classList.add("hide");

  container.appendChild(text);
  refs.playerContainer.appendChild(container);

  return {
    container,
    text,
    playerContainer: refs.playerContainer
  };
}

function clearSubtitleMirror(video = null, settings = null) {
  var cleared = false;
  var refs = getSubtitleMirrorElements(video);
  if (refs.text instanceof HTMLElement) {
    refs.text.textContent = "";
    refs.text.classList.add("hide");
    if (settings) {
      applySubtitleTextStyles(refs.text, settings);
    }
    cleared = true;
  }

  if (video || cleared) return;

  document
    .querySelectorAll(".videoSubtitles[data-jms-subtitle-mirror='1'] .videoSubtitlesInner")
    .forEach(function((node) {
      if (!(node instanceof HTMLElement)) return;
      node.textContent = "";
      node.classList.add("hide");
      if (settings) {
        applySubtitleTextStyles(node, settings);
      }
    });
}

function restoreMirroredSubtitleTracks(video = null) {
  var tracks = video.textTracks;
  if (tracks) {
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      if (!track || !mirroredSubtitleTrackModes.has(track)) continue;
      var prevMode = mirroredSubtitleTrackModes.get(track);
      mirroredSubtitleTrackModes.delete(track);
      try {
        if (track.mode === "hidden" && prevMode === "showing") {
          track.mode = prevMode;
        }
      } catch {}
    }
  }

  for (var [track, prevMode] of mirroredSubtitleTrackModes.entries()) {
    try {
      if (track.mode === "hidden" && prevMode === "showing") {
        track.mode = prevMode;
      }
    } catch {}
    mirroredSubtitleTrackModes.delete(track);
  }
}

function isTrackMirrorEligible(track) {
  if (!track || typeof track !== "object") return false;
  return track.mode === "showing" || track.mode === "hidden";
}

function getTrackCueText(cue) {
  if (!cue) return "";

  var rawText = typeof cue.text === "string" ? cue.text : "";
  if (rawText.trim()) return rawText;

  try {
    var fragment = cue.getCueAsHTML.();
    if (!fragment) return "";
    var holder = document.createElement("div");
    holder.appendChild(fragment.cloneNode(true));
    return holder.textContent || "";
  } catch {}

  return "";
}

function syncSubtitleMirror(video, settings, options = null) {
  var disabled = options.disabled === true;
  var hasComplexRenderer = options.hasComplexRenderer === true;
  var tracks = getSubtitleTracks(video, false);
  var mirrorTrack = null;

  if (!disabled && !hasComplexRenderer) {
    mirrorTrack =
      tracks.findfunction((track) isTrackMirrorEligible(track) && track.mode === "showing") ||
      tracks.findfunction((track) mirroredSubtitleTrackModes.has(track) && track.mode === "hidden") ||
      tracks.findfunction((track) isTrackMirrorEligible(track) && track.mode === "hidden");
  }

  if (!mirrorTrack) {
    restoreMirroredSubtitleTracks(video);
    clearSubtitleMirror(video, settings);
    return false;
  }

  if (!mirroredSubtitleTrackModes.has(mirrorTrack)) {
    mirroredSubtitleTrackModes.set(mirrorTrack, mirrorTrack.mode || "showing");
  }

  try {
    if (mirrorTrack.mode !== "hidden") {
      mirrorTrack.mode = "hidden";
    }
  } catch {}

  var refs = ensureSubtitleMirror(video);
  if (!(refs.container instanceof HTMLElement) || !(refs.text instanceof HTMLElement)) {
    return false;
  }

  applySubtitleContainerStyles(refs.container, settings);

  var activeCues = mirrorTrack.activeCues;
  var lines = [];
  var seen = new Set();

  for (var i = 0; activeCues && i < activeCues.length; i++) {
    var cue = activeCues[i];
    var text = getTrackCueText(cue);
    var normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    lines.push(normalized);
  }

  if (!lines.length) {
    refs.text.textContent = "";
    refs.text.classList.add("hide");
    applySubtitleTextStyles(refs.text, settings);
    return true;
  }

  refs.text.textContent = lines.join("\n");
  refs.text.classList.remove("hide");
  applySubtitleTextStyles(refs.text, settings);
  return true;
}

function applySubtitleContainerStyles(container, settings) {
  if (!(container instanceof HTMLElement)) return;

  setElementStyle(container, "width", "100%");
  setElementStyle(container, "left", "0");
  setElementStyle(container, "right", "0");
  setElementStyle(container, "pointer-events", "none");

  if (settings.position === "top") {
    setElementStyle(container, "top", "0");
    setElementStyle(container, "bottom", null);
    setElementStyle(container, "transform", null);
  } else if (settings.position === "center") {
    setElementStyle(container, "top", "50%");
    setElementStyle(container, "bottom", null);
    setElementStyle(container, "transform", "translateY(-50%)");
  } else {
    setElementStyle(container, "top", null);
    setElementStyle(container, "bottom", "0");
    setElementStyle(container, "transform", null);
  }
}

function applySubtitleTextStyles(subtitleText, settings) {
  if (!(subtitleText instanceof HTMLElement)) return;

  var fontStack = resolveFontStack(settings);
  var textShadow = getTextShadowValue(
    settings.dropShadow,
    settings.shadowColor,
    settings.shadowSize,
    settings.shadowDirection,
    settings.shadowOpacity
  );
  var textColor = getTextColorValue(settings);
  var textBackground = getBackgroundColorValue(settings);
  var backgroundRadius = getBackgroundRadiusCssValue(settings);
  var hasBackground = !!settings.backgroundEnabled;
  var isHidden =
    subtitleText.hidden ||
    subtitleText.classList.contains("hide") ||
    !String(subtitleText.textContent || "").trim();

  setElementStyle(subtitleText, "color", textColor);
  setElementStyle(subtitleText, "font-size", (settings.sizePercent) + "%");
  setElementStyle(subtitleText, "font-family", fontStack);
  setElementStyle(subtitleText, "text-shadow", textShadow);
  setElementStyle(subtitleText, "line-height", "1.3");
  setElementStyle(subtitleText, "text-align", "center");
  setElementStyle(subtitleText, "background-color", textBackground, "important");
  setElementStyle(subtitleText, "padding", hasBackground ? SUBTITLE_BACKGROUND_PADDING : "0", "important");
  setElementStyle(subtitleText, "border-radius", hasBackground ? backgroundRadius : "0", "important");
  setElementStyle(
    subtitleText,
    "display",
    isHidden ? "none" : (hasBackground ? "block" : "inline"),
    "important"
  );
  setElementStyle(subtitleText, "width", hasBackground ? "fit-content" : "auto", "important");
  setElementStyle(subtitleText, "max-width", hasBackground ? "calc(100% - 1.8em)" : "100%", "important");
  setElementStyle(subtitleText, "margin-left", hasBackground ? "auto" : "0", "important");
  setElementStyle(subtitleText, "margin-right", hasBackground ? "auto" : "0", "important");
  setElementStyle(subtitleText, "box-decoration-break", hasBackground ? "clone" : "slice", "important");
  setElementStyle(subtitleText, "-webkit-box-decoration-break", hasBackground ? "clone" : "slice", "important");
  setElementStyle(subtitleText, "background-clip", "padding-box", "important");
  setElementStyle(subtitleText, "white-space", "pre-line", "important");
  setElementStyle(subtitleText, "overflow-wrap", "anywhere", "important");

  if (settings.position === "top") {
    setElementStyle(subtitleText, "margin-top", "1.2em");
    setElementStyle(subtitleText, "margin-bottom", "0");
  } else if (settings.position === "center") {
    setElementStyle(subtitleText, "margin-top", "0");
    setElementStyle(subtitleText, "margin-bottom", "0");
  } else {
    setElementStyle(subtitleText, "margin-top", "0");
    setElementStyle(subtitleText, "margin-bottom", "1.2em");
  }
}

function applySubtitleAppearancePair(windowEl, textEl, settings) {
  var resolved = getLiveSubtitleCustomizerSettings(settings);
  applySubtitleContainerStyles(windowEl, resolved);
  applySubtitleTextStyles(textEl, resolved);
}

function applyOverlayStyles(settings) {
  var containers = document.querySelectorAll(".videoSubtitles");
  containers.forEach(function((container) {
    applySubtitleContainerStyles(container, settings);
  });

  var subtitles = document.querySelectorAll(".videoSubtitlesInner, .videoSecondarySubtitlesInner");
  subtitles.forEach(function((subtitleText) {
    applySubtitleTextStyles(subtitleText, settings);
  });
}

function patchPlayerSubtitleAppearance(player, settings = null) {
  if (!player || typeof player !== "object") return false;
  if (patchedSubtitleAppearancePlayers.has(player)) return true;
  if (typeof player.setSubtitleAppearance !== "function") return false;

  var original = player.setSubtitleAppearance;
  if (typeof original !== "function") return false;

  var wrapped = function patchedSetSubtitleAppearance(windowEl, textEl, ...args) {
    var result;
    try {
      result = original.call(this, windowEl, textEl, ...args);
    } finally {
      try {
        applySubtitleAppearancePair(windowEl, textEl, settings);
      } catch {}
    }
    return result;
  };

  try {
    player.setSubtitleAppearance = wrapped;
    patchedSubtitleAppearancePlayers.add(player);
    patchedSubtitleAppearanceMeta.set(player, { original, wrapped });
    return true;
  } catch {
    return false;
  }
}

function unpatchAllPlayerSubtitleAppearance() {
  patchedSubtitleAppearancePlayers.forEach(function((player) {
    var meta = patchedSubtitleAppearanceMeta.get(player);
    if (!meta) return;
    try {
      if (player.setSubtitleAppearance === meta.wrapped) {
        player.setSubtitleAppearance = meta.original;
      }
    } catch {}
    patchedSubtitleAppearanceMeta.delete(player);
  });
  patchedSubtitleAppearancePlayers.clear();
}

function getComplexSubtitleScale(sizePercent) {
  var normalized = clampNumber(sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent);
  var scale = normalized / DEFAULT_SETTINGS.sizePercent;
  return Math.max(0.55, Math.min(2.2, Math.round(scale * 1000) / 1000));
}

function getComplexSubtitleShiftPercent(position) {
  if (position === "top") return -36;
  if (position === "center") return -18;
  return 0;
}

function getComplexSubtitleTransformOrigin(position) {
  if (position === "top") return "center top";
  if (position === "center") return "center center";
  return "center bottom";
}

function normalizeTransformString(value) {
  var normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized === "none") return "";
  return normalized;
}

function isLegacyComplexSubtitleTransform(value) {
  var normalized = normalizeTransformString(value);
  if (!normalized) return false;
  return /^(?:translateY\([^)]+\)\s*)?(?:scale\([^)]+\))?$/.test(normalized);
}

function supportsIndependentTransformProperties() {
  try {
    return (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("scale", "1") &&
      CSS.supports("translate", "0 0")
    );
  } catch {
    return false;
  }
}

function applyComplexSubtitleTransformFallback(node, extraTransform) {
  var currentTransform = normalizeTransformString(node.style.getPropertyValue("transform"));
  var lastComposite = normalizeTransformString(node.dataset.jmsSubtitleComplexComposite);
  var lastBase = normalizeTransformString(node.dataset.jmsSubtitleComplexBase);

  var baseTransform = lastBase;
  if (currentTransform && currentTransform !== lastComposite && !isLegacyComplexSubtitleTransform(currentTransform)) {
    baseTransform = currentTransform;
  }

  var nextTransform = [baseTransform, normalizeTransformString(extraTransform)]
    .filter(Boolean)
    .join(" ");

  if (baseTransform) node.dataset.jmsSubtitleComplexBase = baseTransform;
  else delete node.dataset.jmsSubtitleComplexBase;

  if (nextTransform) {
    node.style.setProperty("transform", nextTransform, "important");
    node.dataset.jmsSubtitleComplexComposite = nextTransform;
  } else {
    node.style.removeProperty("transform");
    delete node.dataset.jmsSubtitleComplexComposite;
  }
}

function collectComplexSubtitleNodes() {
  var assParents = Array.from(
    document.querySelectorAll(".videoPlayerContainer .libassjs-canvas-parent")
  );
  var assFallbackCanvases = Array.from(
    document.querySelectorAll(".videoPlayerContainer canvas.libassjs-canvas")
  ).filterfunction((canvas) !canvas.closest(".libassjs-canvas-parent"));
  var imageSubtitleCanvases = Array.from(
    document.querySelectorAll(".videoPlayerContainer canvas")
  ).filterfunction((canvas) !canvas.classList.contains("libassjs-canvas") && isLikelyImageSubtitleCanvas(canvas)
  );

  return {
    assParents,
    assFallbackCanvases,
    assNodes: [...assParents, ...assFallbackCanvases],
    imageSubtitleCanvases,
    all: [...assParents, ...assFallbackCanvases, ...imageSubtitleCanvases]
  };
}

function isPlaybackManagerLike(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  return (
    typeof value.setSubtitleOffset === "function" ||
    typeof value.getActivePlayer === "function" ||
    typeof value.supportSubtitleOffset === "function" ||
    typeof value.getPlayerSubtitleOffset === "function"
  );
}

function collectPlaybackManagers() {
  var now = Date.now();
  if (now - playbackManagersCache.at < 2500) {
    return playbackManagersCache.list;
  }

  var out = [];
  var seen = new Set();
  var add = function(candidate) {
    if (!isPlaybackManagerLike(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  [
    window.playbackManager,
    window.MediaBrowser.playbackManager,
    window.MediaBrowser.PlaybackManager,
    window.Emby.playbackManager,
    window.Emby.PlaybackManager,
    window.appRouter.playbackManager,
    window.dashboardPage.playbackManager,
    window.__playbackManager,
    window.__jellyfinPlaybackManager,
    window.__jmsPlaybackManager
  ].forEach(add);

  try {
    var windowKeys = Object.getOwnPropertyNames(window);
    for (var i = 0; i < windowKeys.length; i++) {
      var key = windowKeys[i];
      if (!/playback/i.test(key)) continue;
      var value;
      try {
        value = window[key];
      } catch {
        continue;
      }
      add(value);
    }
  } catch {}

  playbackManagersCache = {
    at: now,
    list: out
  };
  return out;
}

function collectPlayerCandidates(playbackManagers) {
  var out = [];
  var seen = new Set();
  var add = function(candidate) {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  add(window.MediaPlayer.getActivePlayer.());
  add(window.MediaBrowser.MediaPlayer.getActivePlayer.());
  add(window.player);
  add(window.currentPlayer);
  add(window.__jmsPlayer);

  (playbackManagers || []).forEach(function((manager) {
    try {
      add(manager.getActivePlayer.());
    } catch {}
    try {
      add(manager._currentPlayer);
    } catch {}
  });

  try {
    var windowKeys = Object.getOwnPropertyNames(window);
    for (var i = 0; i < windowKeys.length; i++) {
      var key = windowKeys[i];
      if (!/player/i.test(key)) continue;
      var value;
      try {
        value = window[key];
      } catch {
        continue;
      }
      if (value && typeof value === "object" && typeof value.setSubtitleOffset === "function") {
        add(value);
      }
      if (value && typeof value.getActivePlayer === "function") {
        try {
          add(value.getActivePlayer());
        } catch {}
      }
    }
  } catch {}

  return out;
}

function isLikelyImageSubtitleCanvas(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) return false;
  if (canvas.classList.contains("libassjs-canvas")) return false;

  var parent = canvas.parentElement;
  if (!parent || !parent.querySelector("video.htmlvideoplayer, video")) return false;

  var style;
  try {
    style = getComputedStyle(canvas);
  } catch {
    return false;
  }
  if (!style) return false;
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (!/absolute|fixed/.test(style.position || "")) return false;
  if ((style.pointerEvents || "").toLowerCase() !== "none") return false;

  var rect = canvas.getBoundingClientRect.();
  if (!rect || rect.width < 2 || rect.height < 2) return false;

  var classHints = (canvas.className || "") + " " + (parent.className || "").toLowerCase();
  var nameLooksLikeSubtitle = /pgs|sub|subtitle|caption|overlay|dvd|vob/.test(classHints);
  var styleLooksLikeSubtitle =
    (canvas.style.width === "100%" && canvas.style.height === "100%") ||
    !!canvas.style.objectFit ||
    style.objectFit !== "fill" ||
    style.inset !== "auto";

  return nameLooksLikeSubtitle || styleLooksLikeSubtitle;
}

function applyComplexSubtitleStyles(settings) {
  var scale = getComplexSubtitleScale(settings.sizePercent);
  var shiftPercent = getComplexSubtitleShiftPercent(settings.position);
  var shiftValue = shiftPercent ? "0 " + (shiftPercent) + "%" : "";
  var shiftTransform = shiftPercent ? "translateY(" + (shiftPercent) + "%)" : "";
  var scaledTransform = (shiftTransform) + (shiftTransform ? " " : "") + "scale(" + (scale) + ")";
  var transformOrigin = getComplexSubtitleTransformOrigin(settings.position);
  var useIndependentTransforms = supportsIndependentTransformProperties();
  var complexNodes = collectComplexSubtitleNodes();

  [
    { nodes: complexNodes.assNodes, allowScale: false },
    { nodes: complexNodes.imageSubtitleCanvases, allowScale: true }
  ].forEach(function(({ nodes, allowScale }) {
    nodes.forEach(function((node) {
      if (!(node instanceof HTMLElement)) return;
      node.style.setProperty("transform-origin", transformOrigin, "important");
      if (useIndependentTransforms) {
        var currentTransform = normalizeTransformString(node.style.getPropertyValue("transform"));
        if (isLegacyComplexSubtitleTransform(currentTransform)) {
          node.style.removeProperty("transform");
        }

        if (shiftValue) node.style.setProperty("translate", shiftValue, "important");
        else node.style.removeProperty("translate");

        if (allowScale && Math.abs(scale - 1) > 0.001) {
          node.style.setProperty("scale", String(scale), "important");
        } else {
          node.style.removeProperty("scale");
        }
      } else {
        applyComplexSubtitleTransformFallback(
          node,
          allowScale ? scaledTransform : shiftTransform
        );
      }
      node.style.setProperty(
        "will-change",
        useIndependentTransforms
          ? (allowScale ? "transform, translate, scale" : "transform, translate")
          : "transform"
      );
    });
  });
}

function applyNativeSubtitleOffsetViaUi(delaySec) {
  var normalized = normalizeDelaySeconds(delaySec);
  var slider = document.querySelector(".subtitleSyncSlider");
  if (!(slider instanceof HTMLInputElement)) return false;

  var next = String(normalized);
  var applied = false;

  try {
    if (typeof slider.updateOffset === "function") {
      slider.updateOffset(normalized);
      applied = true;
    }
  } catch {}

  if (!applied) {
    try {
      if (slider.value !== next) slider.value = next;
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      applied = true;
    } catch {}
  }

  return applied;
}

function syncNativeSubtitleSyncUi(delaySec, opts = null) {
  var normalized = normalizeDelaySeconds(delaySec);

  var slider = document.querySelector(".subtitleSyncSlider");
  var sliderValueRaw = slider instanceof HTMLInputElement ? Number(slider.value) : null;
  var sliderValueChanged = false;
  if (slider instanceof HTMLInputElement) {
    var next = String(normalized);
    if (slider.value !== next) {
      slider.value = next;
      sliderValueChanged = true;
    }
  }

  var textField = document.querySelector(".subtitleSyncTextField");
  if (textField instanceof HTMLElement) {
    textField.textContent = (normalized) + "s";
  }

  if (opts.applyToPlayer) {
    var sliderAlreadyZero =
      slider instanceof HTMLInputElement &&
      Number.isFinite(sliderValueRaw) &&
      Math.abs(sliderValueRaw) <= 0.051;
    var cacheMatches =
      slider instanceof HTMLInputElement &&
      nativeSubtitleUiOffsetCache.slider === slider &&
      Math.abs(Number(nativeSubtitleUiOffsetCache.value) - normalized) <= 0.051;
    if (
      Math.abs(normalized) <= 0.051 &&
      !sliderValueChanged &&
      sliderAlreadyZero &&
      nativeSubtitleUiOffsetCache.slider !== slider
    ) {
      return false;
    }
    if (!sliderValueChanged && cacheMatches) {
      return false;
    }
    var applied = applyNativeSubtitleOffsetViaUi(normalized);
    if (applied && slider instanceof HTMLInputElement) {
      nativeSubtitleUiOffsetCache = {
        slider,
        value: normalized
      };
    }
    return applied;
  }
  return false;
}

function getCachedSubtitleOffset(target, playerArg = null) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) return null;
  var entry = cachedSubtitleOffsets.get(target);
  if (!entry) return null;

  if (
    playerArg &&
    playerArg !== target &&
    (typeof playerArg === "object" || typeof playerArg === "function")
  ) {
    return entry.byPlayer.get(playerArg) || null;
  }

  return entry.self || null;
}

function setCachedSubtitleOffset(target, sec, playerArg = null) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) return;

  var entry = cachedSubtitleOffsets.get(target);
  if (!entry) {
    entry = {
      self: null,
      byPlayer: new WeakMap()
    };
    cachedSubtitleOffsets.set(target, entry);
  }

  if (
    playerArg &&
    playerArg !== target &&
    (typeof playerArg === "object" || typeof playerArg === "function")
  ) {
    entry.byPlayer.set(playerArg, sec);
    return;
  }

  entry.self = sec;
}

function tryRefreshPlayerAppearance(settings) {
  var subtitleDelayRaw = Number(settings.delaySec);
  var playbackManagers = collectPlaybackManagers();
  var players = collectPlayerCandidates(playbackManagers);
  var didApplySubtitleDelay = false;
  var managerApplyAttempts = 0;
  var managerApplySuccess = 0;
  var playerApplyAttempts = 0;
  var playerApplySuccess = 0;
  var nativeUiApplied = false;

  players.forEach(function((player) {
    try {
      patchPlayerSubtitleAppearance(player, settings);
    } catch {}
  });

  var readSubtitleOffset = function(target, playerArg = null) {
    if (!target || typeof target !== "object") return null;

    try {
      if (typeof target.getSubtitleOffset === "function") {
        var value = Number(target.getSubtitleOffset());
        if (Number.isFinite(value)) return value;
      }
    } catch {}

    try {
      if (typeof target.getPlayerSubtitleOffset === "function") {
        var value = Number(target.getPlayerSubtitleOffset(playerArg || undefined));
        if (Number.isFinite(value)) return value;
      }
    } catch {}

    return null;
  };

  var applyOffsetToTarget = function(target, sec, playerArg = null) {
    if (!target || typeof target.setSubtitleOffset !== "function") return false;

    var isVerified = function(didInvoke) {
      if (!didInvoke) return false;
      var appliedOffset = readSubtitleOffset(target, playerArg);
      if (!Number.isFinite(appliedOffset)) return false;
      if (Math.abs(appliedOffset - sec) > 0.051) {
        return false;
      }
      didApplySubtitleDelay = true;
      setCachedSubtitleOffset(target, sec, playerArg);
      return true;
    };

    var currentOffset = readSubtitleOffset(target, playerArg);
    if (Number.isFinite(currentOffset) && Math.abs(currentOffset - sec) <= 0.051) {
      didApplySubtitleDelay = true;
      setCachedSubtitleOffset(target, sec, playerArg);
      return true;
    }

    var cachedOffset = getCachedSubtitleOffset(target, playerArg);
    if (Number.isFinite(cachedOffset) && Math.abs(cachedOffset - sec) <= 0.051) {
      return false;
    }

    if (
      Math.abs(sec) <= 0.051 &&
      !Number.isFinite(currentOffset) &&
      !Number.isFinite(cachedOffset)
    ) {
      return false;
    }

    var invoked = false;
    try {
      if (playerArg && playerArg !== target) target.setSubtitleOffset(sec, playerArg);
      else target.setSubtitleOffset(sec);
      invoked = true;
      if (!Number.isFinite(currentOffset)) {
        setCachedSubtitleOffset(target, sec, playerArg);
      }
      return isVerified(invoked);
    } catch {
      if (!playerArg) return false;
      try {
        target.setSubtitleOffset(sec);
        invoked = true;
        if (!Number.isFinite(currentOffset)) {
          setCachedSubtitleOffset(target, sec, null);
        }
        return isVerified(invoked);
      } catch {
        return false;
      }
    }
  };

  if (Number.isFinite(subtitleDelayRaw)) {
    var subtitleDelay = normalizeDelaySeconds(subtitleDelayRaw);

    var tryManagerApply = function(manager, player = null) {
      if (!manager || typeof manager !== "object") return false;
      var targetPlayer = player || manager.getActivePlayer.() || null;

      if (Math.abs(subtitleDelay) > 0.051) {
        try {
          if (typeof manager.enableShowingSubtitleOffset === "function") {
            manager.enableShowingSubtitleOffset(targetPlayer || undefined);
          }
        } catch {}
      }

      return applyOffsetToTarget(manager, subtitleDelay, targetPlayer);
    };

    playbackManagers.forEach(function((manager) {
      if (!manager || typeof manager !== "object") return;
      if (typeof manager.setSubtitleOffset !== "function") return;

      managerApplyAttempts += 1;
      if (tryManagerApply(manager, null)) managerApplySuccess += 1;
      players.forEach(function((player) {
        managerApplyAttempts += 1;
        if (tryManagerApply(manager, player)) managerApplySuccess += 1;
      });
    });

    players.forEach(function((player) {
      if (!player || typeof player !== "object") return;
      playerApplyAttempts += 1;
      if (applyOffsetToTarget(player, subtitleDelay)) playerApplySuccess += 1;
    });

    nativeUiApplied = syncNativeSubtitleSyncUi(subtitleDelay, { applyToPlayer: true });
    if (nativeUiApplied) didApplySubtitleDelay = true;
  }

  players.forEach(function((player) {
    if (!player || typeof player !== "object") return;
    try {
      if (typeof player.setCueAppearance === "function") {
        player.setCueAppearance();
      }
    } catch {}

    try {
      var windowEl = document.querySelector(".videoSubtitles");
      var primaryTextEl = document.querySelector(".videoSubtitlesInner");
      var secondaryTextEl = document.querySelector(".videoSecondarySubtitlesInner");
      if (typeof player.setSubtitleAppearance === "function" && windowEl) {
        if (primaryTextEl) player.setSubtitleAppearance(windowEl, primaryTextEl);
        if (secondaryTextEl) player.setSubtitleAppearance(windowEl, secondaryTextEl);
      }
    } catch {}
  });

  return {
    didApplySubtitleDelay,
    managerCount: playbackManagers.length,
    playerCount: players.length,
    managerApplyAttempts,
    managerApplySuccess,
    playerApplyAttempts,
    playerApplySuccess,
    nativeUiApplied
  };
}

function getShowingSubtitleTracks(video) {
  return getSubtitleTracks(video, true);
}

function getSubtitleTracks(video, showingOnly = false) {
  if (!video || !video.textTracks) return [];
  var out = [];
  var tracks = video.textTracks;
  for (var i = 0; i < tracks.length; i++) {
    var track = tracks[i];
    var kind = String(track.kind || "").toLowerCase();
    var isSubtitleLike = kind === "subtitles" || kind === "captions" || !kind;
    if (!isSubtitleLike) continue;
    if (showingOnly && track.mode !== "showing") continue;
    if (!showingOnly && !["showing", "hidden", "disabled"].includes(track.mode)) continue;
    if (track) {
      out.push(track);
    }
  }
  return out;
}

function isVisible(el) {
  if (!el) return false;
  var rect = el.getBoundingClientRect.();
  if (!rect || rect.width < 2 || rect.height < 2) return false;
  var st = getComputedStyle(el);
  return st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
}

function scoreVideoCandidate(video) {
  try {
    if (!(video instanceof HTMLVideoElement)) return -1e9;
    var score = 0;
    if (video.classList.contains("htmlvideoplayer")) score += 1000;
    if (video.closest(".htmlvideoplayer")) score += 900;
    if (!video.paused && !video.ended) score += 140;
    if (video.controls) score += 60;
    if ((video.currentSrc || "").startsWith("blob:")) score += 120;
    if (isVisible(video)) score += 90;
    if (video.videoWidth > 0 && video.videoHeight > 0) score += 40;
    return score;
  } catch {
    return -1e9;
  }
}

function pickActiveVideo() {
  var pinned = window.__jmsActiveVideo;
  if (pinned instanceof HTMLVideoElement && pinned.isConnected) {
    return pinned;
  }
  var best = null;
  var bestScore = -1e9;
  document.querySelectorAll("video").forEach(function((video) {
    var s = scoreVideoCandidate(video);
    if (s > bestScore) {
      bestScore = s;
      best = video;
    }
  });
  return bestScore > -1e6 ? best : null;
}

function applyPositionToCue(cue, position) {
  try {
    if (position === "bottom") {
      cue.snapToLines = true;
      cue.line = -1;
      return;
    }
    if (position === "top") {
      cue.snapToLines = true;
      cue.line = 0;
      return;
    }
    cue.snapToLines = false;
    cue.line = 50;
    try {
      cue.position = 50;
    } catch {}
  } catch {}
}

function shiftTrackCues(track, settings) {
  var cues = track.cues;
  var cueCount = cues.length || 0;
  if (!cueCount) return false;

  var normalizedPosition = POSITION_VALUES.includes(settings.position)
    ? settings.position
    : DEFAULT_SETTINGS.position;
  var firstCue = cues[0];
  var lastCue = cues[cueCount - 1];
  var prevState = trackCuePositionSyncState.get(track);

  if (
    prevState &&
    prevState.position === normalizedPosition &&
    prevState.cueCount === cueCount &&
    prevState.firstCue === firstCue &&
    prevState.lastCue === lastCue
  ) {
    return false;
  }

  for (var i = 0; i < cueCount; i++) {
    var cue = cues[i];
    applyPositionToCue(cue, normalizedPosition);
  }

  trackCuePositionSyncState.set(track, {
    position: normalizedPosition,
    cueCount,
    firstCue,
    lastCue
  });

  return true;
}

function shiftTrackCueTimings(track, delaySec) {
  var cues = track.cues;
  var cueCount = cues.length || 0;
  var normalizedDelay = normalizeDelaySeconds(delaySec);
  var firstCue = cueCount ? cues[0] : null;
  var lastCue = cueCount ? cues[cueCount - 1] : null;
  var prevState = trackCueTimingSyncState.get(track);

  if (
    prevState &&
    prevState.delaySec === normalizedDelay &&
    prevState.cueCount === cueCount &&
    prevState.firstCue === firstCue &&
    prevState.lastCue === lastCue
  ) {
    return false;
  }

  var changed = false;

  for (var i = 0; i < cueCount; i++) {
    var cue = cues[i];
    if (!cue) continue;

    var timing = originalCueTimings.get(cue);
    if (!timing) {
      var startTime = Number(cue.startTime);
      var endTime = Number(cue.endTime);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
      timing = { startTime, endTime };
      originalCueTimings.set(cue, timing);
    }

    var duration = Math.max(0, timing.endTime - timing.startTime);
    var nextStart = timing.startTime - normalizedDelay;
    if (nextStart < 0) nextStart = 0;
    var nextEnd = nextStart + duration;

    var startChanged = Math.abs(Number(cue.startTime) - nextStart) > 0.0005;
    var endChanged = Math.abs(Number(cue.endTime) - nextEnd) > 0.0005;
    if (!startChanged && !endChanged) continue;

    try {
      cue.startTime = nextStart;
      cue.endTime = nextEnd;
      changed = true;
    } catch {}
  }

  trackCueTimingSyncState.set(track, {
    delaySec: normalizedDelay,
    cueCount,
    firstCue,
    lastCue
  });

  return changed;
}

function setSubtitleDialogOpenState(isOpen) {
  try {
    document.documentElement.classList.toggle("jms-subtitle-dialog-open", !!isOpen);
  } catch {}
  try {
    document.body.classList.toggle("jms-subtitle-dialog-open", !!isOpen);
  } catch {}
}

function isPlaybackScreenActive() {
  var hasControls = !!document.querySelector(".videoOsdBottom.videoOsdBottom-maincontrols .buttons");
  var hasPlayerContainer = !!document.querySelector(".videoPlayerContainer");
  var hasPlayerVideo = !!document.querySelector(".videoPlayerContainer video.htmlvideoplayer, .videoPlayerContainer video");
  return hasControls || (hasPlayerContainer && hasPlayerVideo);
}

function createDialog(settings, onUpdate, onReset, onClosed) {
  document.querySelectorAll("[" + (DIALOG_ATTR) + "]").forEach(function((node) node.remove());

  var backdrop = document.createElement("div");
  backdrop.className = "dialogBackdrop";
  backdrop.setAttribute(DIALOG_ATTR, "1");

  var container = document.createElement("div");
  container.className = "dialogContainer";
  container.setAttribute(DIALOG_ATTR, "1");

  var fontOptionsHtml = getFontOptions().mapfunction((opt) {
    var selected = opt.value === settings.fontFamily ? "selected" : "";
    return "<option value=\"" + (escapeAttr(opt.value)) + "\" " + (selected) + ">" + (escapeAttr(opt.label)) + "</option>";
  }).join("");
  var shadowOptionsHtml = SHADOW_OPTIONS.mapfunction((opt) {
    var selected = opt.value === settings.dropShadow ? "selected" : "";
    return "<option value=\"" + (escapeAttr(opt.value)) + "\" " + (selected) + ">" + (escapeAttr(opt.label)) + "</option>";
  }).join("");
  var colorOpacityInitialValue = normalizeColorOpacity(settings.colorOpacity);
  var shadowColorValue = normalizeShadowColor(settings.shadowColor);
  var shadowOpacityInitialValue = normalizeShadowOpacity(settings.shadowOpacity);
  var shadowSizeInitialValue = normalizeShadowSize(settings.shadowSize);
  var shadowDirectionInitialValue = normalizeShadowDirection(settings.shadowDirection);
  var backgroundColorValue = normalizeBackgroundColor(settings.backgroundColor);
  var backgroundOpacityInitialValue = normalizeBackgroundOpacity(settings.backgroundOpacity);
  var backgroundRadiusValue = normalizeBackgroundRadius(settings.backgroundRadiusPx);
  var delaySummaryValue = formatDelayValue(settings.delaySec);
  var backLabel = L("subtitleCustomizerBack", "Voltar");

  container.innerHTML = "\n    <div id=\"" + (DIALOG_ID) + "\" class=\"focuscontainer dialog opened jms-subtitle-dialog\" role=\"dialog\" aria-modal=\"true\">\n      <div class=\"formDialog\">\n        <div class=\"formDialogHeader\">\n          <button type=\"button\" is=\"paper-icon-button-light\" class=\"btnCancel autoSize\" title=\"" + (escapeAttr(backLabel)) + "\">\n            " + (faIconHtml("arrowLeft", "jms-subtitle-icon")) + "\n          </button>\n          <h3 class=\"formDialogHeaderTitle\">" + (escapeAttr(L("subtitleCustomizerDialogTitle", "Configurações de Legendas"))) + "</h3>\n        </div>\n        <div class=\"formDialogContent scrollY jms-subtitle-formContent\">\n          <div class=\"dialogContentInner dialog-content-centered jms-subtitle-content\">\n            <div class=\"jms-subtitle-previewWrap\">\n              <div class=\"jms-subtitle-previewTitle\">" + (escapeAttr(L("subtitleCustomizerPreviewTitle", "Prévia em Tempo Real"))) + "</div>\n              <div class=\"jms-subtitle-previewStage\" data-position=\"" + (escapeAttr(settings.position)) + "\">\n                <div class=\"jms-subtitle-previewCaption\">\n                  <div class=\"jms-subtitle-previewText\">" + (escapeAttr(L("subtitleCustomizerPreviewLine1", "Esta é uma linha de prévia."))) + "\\n" + (escapeAttr(L("subtitleCustomizerPreviewLine2", "A segunda linha aparece aqui."))) + "</div>\n                </div>\n              </div>\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-size\">" + (escapeAttr(L("subtitleCustomizerSizeLabel", "Tamanho da fonte (%)"))) + "</label>\n              <input id=\"jms-subtitle-size\" type=\"range\" min=\"60\" max=\"220\" step=\"1\" value=\"" + (settings.sizePercent) + "\" />\n              <div class=\"fieldDescription\"><span id=\"jms-subtitle-size-value\">" + (settings.sizePercent) + "%</span></div>\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-color\">" + (escapeAttr(L("subtitleCustomizerColorLabel", "Cor da fonte"))) + "</label>\n              <input id=\"jms-subtitle-color\" class=\"jms-subtitle-colorInput\" type=\"color\" value=\"" + (settings.color) + "\" />\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-color-opacity\">" + (escapeAttr(L("subtitleCustomizerColorOpacityLabel", "Opacidade da fonte"))) + "</label>\n              <input id=\"jms-subtitle-color-opacity\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"" + (colorOpacityInitialValue) + "\" />\n              <div class=\"fieldDescription\"><span id=\"jms-subtitle-color-opacity-value\">" + (colorOpacityInitialValue) + "%</span></div>\n            </div>\n\n            <div class=\"selectContainer\">\n              <label class=\"selectLabel\" for=\"jms-subtitle-font\">" + (escapeAttr(L("subtitleCustomizerFontLabel", "Fonte"))) + "</label>\n              <select id=\"jms-subtitle-font\" is=\"emby-select\" class=\"emby-select\">\n                " + (fontOptionsHtml) + "\n              </select>\n            </div>\n\n            <div class=\"selectContainer\">\n              <label class=\"selectLabel\" for=\"jms-subtitle-shadow\">" + (escapeAttr(L("subtitleCustomizerShadowLabel", "Sombra"))) + "</label>\n              <select id=\"jms-subtitle-shadow\" is=\"emby-select\" class=\"emby-select\">\n                " + (shadowOptionsHtml) + "\n              </select>\n            </div>\n\n            <div class=\"inputContainer jms-subtitle-colorRow\">\n              <label for=\"jms-subtitle-shadow-color\">" + (escapeAttr(L("subtitleCustomizerShadowColorLabel", "Cor da sombra"))) + "</label>\n              <input id=\"jms-subtitle-shadow-color\" class=\"jms-subtitle-colorInput\" type=\"color\" value=\"" + (shadowColorValue) + "\" />\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-shadow-opacity\">" + (escapeAttr(L("subtitleCustomizerShadowOpacityLabel", "Opacidade da sombra"))) + "</label>\n              <input id=\"jms-subtitle-shadow-opacity\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"" + (shadowOpacityInitialValue) + "\" />\n              <div class=\"fieldDescription\"><span id=\"jms-subtitle-shadow-opacity-value\">" + (shadowOpacityInitialValue) + "%</span></div>\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-shadow-size\">" + (escapeAttr(L("subtitleCustomizerShadowSizeLabel", "Tamanho da sombra"))) + "</label>\n              <input id=\"jms-subtitle-shadow-size\" type=\"range\" min=\"0\" max=\"24\" step=\"1\" value=\"" + (shadowSizeInitialValue) + "\" />\n              <div class=\"fieldDescription\"><span id=\"jms-subtitle-shadow-size-value\">" + (shadowSizeInitialValue) + "px</span></div>\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-shadow-direction\">" + (escapeAttr(L("subtitleCustomizerShadowDirectionLabel", "Direção da sombra"))) + "</label>\n              <input id=\"jms-subtitle-shadow-direction\" type=\"range\" min=\"0\" max=\"360\" step=\"1\" value=\"" + (shadowDirectionInitialValue) + "\" />\n              <div class=\"fieldDescription\"><span id=\"jms-subtitle-shadow-direction-value\">" + (shadowDirectionInitialValue) + "°</span></div>\n            </div>\n\n            <div class=\"inputContainer jms-subtitle-bgRow\">\n              <label class=\"jms-subtitle-inlineLabel\" for=\"jms-subtitle-bg-enabled\">\n                <input id=\"jms-subtitle-bg-enabled\" type=\"checkbox\" " + (settings.backgroundEnabled ? "checked" : "") + " />\n                <span>" + (escapeAttr(L("subtitleCustomizerBackgroundLabel", "Cor do fundo"))) + "</span>\n              </label>\n              <input id=\"jms-subtitle-bg-color\" class=\"jms-subtitle-colorInput\" type=\"color\" value=\"" + (backgroundColorValue) + "\" " + (settings.backgroundEnabled ? "" : "disabled") + " />\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-bg-opacity\">" + (escapeAttr(L("subtitleCustomizerBackgroundOpacityLabel", "Opacidade do fundo"))) + "</label>\n              <input id=\"jms-subtitle-bg-opacity\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"" + (backgroundOpacityInitialValue) + "\" " + (settings.backgroundEnabled ? "" : "disabled") + " />\n              <div class=\"fieldDescription\"><span id=\"jms-subtitle-bg-opacity-value\">" + (backgroundOpacityInitialValue) + "%</span></div>\n            </div>\n\n            <div class=\"inputContainer\">\n              <label for=\"jms-subtitle-bg-radius\">" + (escapeAttr(L("subtitleCustomizerBackgroundRadiusLabel", "Arredondamento do fundo"))) + "</label>\n              <input id=\"jms-subtitle-bg-radius\" type=\"range\" min=\"" + (MIN_BACKGROUND_RADIUS_PX) + "\" max=\"" + (MAX_BACKGROUND_RADIUS_PX) + "\" step=\"1\" value=\"" + (backgroundRadiusValue) + "\" " + (settings.backgroundEnabled ? "" : "disabled") + " />\n              <div class=\"fieldDescription\"><span id=\"jms-subtitle-bg-radius-value\">" + (backgroundRadiusValue) + "px</span></div>\n            </div>\n\n            <div class=\"selectContainer\">\n              <label class=\"selectLabel\" for=\"jms-subtitle-position\">" + (escapeAttr(L("subtitleCustomizerPositionLabel", "Posição"))) + "</label>\n              <select id=\"jms-subtitle-position\" is=\"emby-select\" class=\"emby-select\">\n                <option value=\"bottom\" " + (settings.position === "bottom" ? "selected" : "") + ">" + (escapeAttr(L("subtitleCustomizerPositionBottom", "Inferior"))) + "</option>\n                <option value=\"center\" " + (settings.position === "center" ? "selected" : "") + ">" + (escapeAttr(L("subtitleCustomizerPositionCenter", "Central"))) + "</option>\n                <option value=\"top\" " + (settings.position === "top" ? "selected" : "") + ">" + (escapeAttr(L("subtitleCustomizerPositionTop", "Superior"))) + "</option>\n              </select>\n            </div>\n\n            <div class=\"inputContainer jms-subtitle-delayLaunch\" role=\"button\" tabindex=\"0\" aria-haspopup=\"dialog\" aria-controls=\"jms-subtitle-delay-focus-panel\">\n              <div class=\"jms-subtitle-delayLaunchHead\">\n                <label>" + (escapeAttr(L("subtitleCustomizerDelayLabel", "Atraso (segundos)"))) + "</label>\n                <span id=\"jms-subtitle-delay-summary\" class=\"jms-subtitle-delaySummaryValue\">" + (delaySummaryValue) + "</span>\n              </div>\n              <div class=\"jms-subtitle-delayLaunchHint\">" + (escapeAttr(L("subtitleCustomizerDelayFocusCta", "Abrir barra de atraso em tempo real"))) + "</div>\n            </div>\n          </div>\n        </div>\n        <div class=\"formDialogFooter\">\n          <button is=\"emby-button\" type=\"button\" class=\"raised button-cancel formDialogFooterItem jms-subtitle-reset\">\n            <span>" + (escapeAttr(L("subtitleCustomizerResetButton", "Redefinir"))) + "</span>\n          </button>\n          <button is=\"emby-button\" type=\"button\" class=\"raised button-submit formDialogFooterItem jms-subtitle-close\">\n            <span>" + (escapeAttr(L("subtitleCustomizerCloseButton", "Fechar"))) + "</span>\n          </button>\n        </div>\n      </div>\n      <div id=\"jms-subtitle-delay-focus-panel\" class=\"jms-subtitle-delayFocusPanel\" hidden>\n        <div class=\"jms-subtitle-delayFocusCard\">\n          <div class=\"jms-subtitle-delayFocusHeader\">\n            <div>\n              <div class=\"jms-subtitle-delayFocusEyebrow\">" + (escapeAttr(L("subtitleCustomizerDelayLiveTitle", "Ajuste de Atraso em Tempo Real"))) + "</div>\n              <div id=\"jms-subtitle-delay-focus-value\" class=\"jms-subtitle-delayFocusValue\">" + (delaySummaryValue) + "</div>\n            </div>\n            <div class=\"jms-subtitle-delayFocusHeaderActions\">\n              <button is=\"emby-button\" type=\"button\" class=\"raised button-submit jms-subtitle-delayFocusDone\">\n                <span>" + (escapeAttr(L("subtitleCustomizerDelayFocusDone", "Voltar ao Painel"))) + "</span>\n              </button>\n              <button is=\"emby-button\" type=\"button\" class=\"raised button-cancel jms-subtitle-delayFocusClose\">\n                <span>" + (escapeAttr(L("subtitleCustomizerCloseButton", "Fechar"))) + "</span>\n              </button>\n            </div>\n          </div>\n          <input id=\"jms-subtitle-delay-live\" class=\"jms-subtitle-delayRange\" type=\"range\" step=\"0.1\" min=\"-30\" max=\"30\" value=\"" + (settings.delaySec.toFixed(1)) + "\" />\n          <div class=\"jms-subtitle-delayFocusScale\" aria-hidden=\"true\">\n            <span>" + (escapeAttr(L("subtitleCustomizerDelayScaleMin", "-30s"))) + "</span>\n            <span>" + (escapeAttr(L("subtitleCustomizerDelayScaleZero", "0.0s"))) + "</span>\n            <span>" + (escapeAttr(L("subtitleCustomizerDelayScaleMax", "+30s"))) + "</span>\n          </div>\n          <div class=\"jms-subtitle-delayFocusActions\">\n            <button is=\"emby-button\" type=\"button\" class=\"raised button-cancel jms-subtitle-delayFocusReset\">\n              <span>" + (escapeAttr(L("subtitleCustomizerDelayReset", "Zerar Atraso"))) + "</span>\n            </button>\n          </div>\n        </div>\n      </div>\n    </div>\n  ";

  document.body.append(backdrop, container);
  setSubtitleDialogOpenState(true);

  var dialogEl = container.querySelector("#" + (DIALOG_ID));
  var keyTrap = function(ev) {
    var t = ev.target;
    if (!(t instanceof Node)) return;

    if (!container.contains(t)) return;
    if (ev.key === "Escape") return;

    try { ev.stopImmediatePropagation.(); } catch {}
    try { ev.stopPropagation.(); } catch {}
  };

  document.addEventListener("keydown", keyTrap, true);
  document.addEventListener("keypress", keyTrap, true);
  document.addEventListener("keyup", keyTrap, true);

  var isClosed = false;

  var close = function() {
    if (isClosed) return;
    isClosed = true;
    backdrop.remove();
    container.remove();
    document.removeEventListener("keydown", onEsc, true);
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", keyTrap, true);
    document.removeEventListener("keypress", keyTrap, true);
    document.removeEventListener("keyup", keyTrap, true);
    setSubtitleDialogOpenState(false);
    try {
      onClosed.();
    } catch {}
  };

  var isDelayFocusMode = false;

  var setDelayFocusMode = function(active) {
    isDelayFocusMode = !!active;
    container.classList.toggle("jms-delay-focus-mode", isDelayFocusMode);
    if (delayFocusPanel instanceof HTMLElement) {
      delayFocusPanel.hidden = !isDelayFocusMode;
    }
    backdrop.style.display = isDelayFocusMode ? "none" : "";
    if (delayLaunch instanceof HTMLElement) {
      delayLaunch.setAttribute("aria-expanded", isDelayFocusMode ? "true" : "false");
    }
    if (isDelayFocusMode) {
      window.requestAnimationFramefunction(() {
        try {
          delayFocusRange.focus.({ preventScroll: true });
        } catch {
          delayFocusRange.focus.();
        }
      });
    }
  };

  var onEsc = function(ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (isDelayFocusMode) {
        setDelayFocusMode(false);
        return;
      }
      close();
    }
  };
  document.addEventListener("keydown", onEsc, true);

  var onDocPointerDown = function(ev) {
    var target = ev.target;
    if (!(target instanceof Node)) {
      close();
      return;
    }
    if (delayFocusPanel && delayFocusPanel.contains(target)) return;
    if (isDelayFocusMode) {
      close();
      return;
    }
    if (dialogEl && dialogEl.contains(target)) return;
    close();
  };
  document.addEventListener("pointerdown", onDocPointerDown, true);

  backdrop.addEventListenerfunction("click", () {
    close();
  });
  container.querySelector(".btnCancel").addEventListener("click", close);
  container.querySelector(".jms-subtitle-close").addEventListener("click", close);

  var size = container.querySelector("#jms-subtitle-size");
  var sizeValue = container.querySelector("#jms-subtitle-size-value");
  var color = container.querySelector("#jms-subtitle-color");
  var colorOpacity = container.querySelector("#jms-subtitle-color-opacity");
  var colorOpacityValue = container.querySelector("#jms-subtitle-color-opacity-value");
  var font = container.querySelector("#jms-subtitle-font");
  var shadow = container.querySelector("#jms-subtitle-shadow");
  var shadowColor = container.querySelector("#jms-subtitle-shadow-color");
  var shadowOpacity = container.querySelector("#jms-subtitle-shadow-opacity");
  var shadowOpacityValue = container.querySelector("#jms-subtitle-shadow-opacity-value");
  var shadowSize = container.querySelector("#jms-subtitle-shadow-size");
  var shadowSizeValue = container.querySelector("#jms-subtitle-shadow-size-value");
  var shadowDirection = container.querySelector("#jms-subtitle-shadow-direction");
  var shadowDirectionValue = container.querySelector("#jms-subtitle-shadow-direction-value");
  var backgroundEnabled = container.querySelector("#jms-subtitle-bg-enabled");
  var backgroundColor = container.querySelector("#jms-subtitle-bg-color");
  var backgroundOpacityInput = container.querySelector("#jms-subtitle-bg-opacity");
  var backgroundOpacityValueText = container.querySelector("#jms-subtitle-bg-opacity-value");
  var backgroundRadiusInput = container.querySelector("#jms-subtitle-bg-radius");
  var backgroundRadiusValueText = container.querySelector("#jms-subtitle-bg-radius-value");
  var position = container.querySelector("#jms-subtitle-position");
  var delayLaunch = container.querySelector(".jms-subtitle-delayLaunch");
  var delaySummary = container.querySelector("#jms-subtitle-delay-summary");
  var delayFocusPanel = container.querySelector("#jms-subtitle-delay-focus-panel");
  var delayFocusRange = container.querySelector("#jms-subtitle-delay-live");
  var delayFocusValue = container.querySelector("#jms-subtitle-delay-focus-value");
  var delayFocusDone = container.querySelector(".jms-subtitle-delayFocusDone");
  var delayFocusClose = container.querySelector(".jms-subtitle-delayFocusClose");
  var delayFocusReset = container.querySelector(".jms-subtitle-delayFocusReset");
  var resetBtn = container.querySelector(".jms-subtitle-reset");
  var previewStage = container.querySelector(".jms-subtitle-previewStage");
  var previewText = container.querySelector(".jms-subtitle-previewText");

  var renderDelayUi = function() {
    var valueText = formatDelayValue(settings.delaySec);
    if (delaySummary) delaySummary.textContent = valueText;
    if (delayFocusValue) delayFocusValue.textContent = valueText;
    if (delayFocusRange) delayFocusRange.value = settings.delaySec.toFixed(1);
  };

  var renderPreview = function() {
    if (!(previewStage instanceof HTMLElement) || !(previewText instanceof HTMLElement)) return;
    var fontStack = resolveFontStack(settings);
    var textShadow = getTextShadowValue(
      settings.dropShadow,
      settings.shadowColor,
      settings.shadowSize,
      settings.shadowDirection,
      settings.shadowOpacity
    );
    var textColor = getTextColorValue(settings);
    var textBackground = getBackgroundColorValue(settings);
    var backgroundRadius = getBackgroundRadiusCssValue(settings);
    var pxSize = Math.round(clampNumber(settings.sizePercent, 60, 220, DEFAULT_SETTINGS.sizePercent) * 0.22);

    previewStage.setAttribute("data-position", settings.position);
    previewText.style.color = textColor;
    previewText.style.fontFamily = fontStack;
    previewText.style.textShadow = textShadow;
    previewText.style.backgroundColor = textBackground;
    previewText.style.padding = settings.backgroundEnabled ? PREVIEW_BACKGROUND_PADDING : "0";
    previewText.style.borderRadius = settings.backgroundEnabled ? backgroundRadius : "0";
    previewText.style.display = settings.backgroundEnabled ? "inline-block" : "";
    previewText.style.boxDecorationBreak = settings.backgroundEnabled ? "clone" : "";
    previewText.style.webkitBoxDecorationBreak = settings.backgroundEnabled ? "clone" : "";
    previewText.style.fontSize = (Math.max(14, Math.min(46, pxSize))) + "px";

    if (backgroundColor) backgroundColor.disabled = !settings.backgroundEnabled;
    if (backgroundOpacityInput) backgroundOpacityInput.disabled = !settings.backgroundEnabled;
    if (backgroundRadiusInput) backgroundRadiusInput.disabled = !settings.backgroundEnabled;
  };

  var emitUpdate = function() {
    settings.sizePercent = Math.round(clampNumber(size.value, 60, 220, DEFAULT_SETTINGS.sizePercent));
    settings.color = normalizeColor(color.value);
    settings.colorOpacity = normalizeColorOpacity(colorOpacity.value || DEFAULT_SETTINGS.colorOpacity);

    var selectedFont = String(font.value || DEFAULT_SETTINGS.fontFamily);
    settings.fontFamily = normalizeFontFamilySelection(selectedFont, DEFAULT_SETTINGS.fontFamily);
    settings.dropShadow = normalizeDropShadow(shadow.value || DEFAULT_SETTINGS.dropShadow);
    settings.shadowColor = normalizeShadowColor(shadowColor.value || DEFAULT_SETTINGS.shadowColor);
    settings.shadowOpacity = normalizeShadowOpacity(shadowOpacity.value || DEFAULT_SETTINGS.shadowOpacity);
    settings.shadowSize = normalizeShadowSize(shadowSize.value || DEFAULT_SETTINGS.shadowSize);
    settings.shadowDirection = normalizeShadowDirection(shadowDirection.value || DEFAULT_SETTINGS.shadowDirection);
    settings.backgroundEnabled = !!backgroundEnabled.checked;
    settings.backgroundColor = normalizeBackgroundColor(backgroundColor.value || DEFAULT_SETTINGS.backgroundColor);
    settings.backgroundOpacity = normalizeBackgroundOpacity(
      backgroundOpacityInput.value || DEFAULT_SETTINGS.backgroundOpacity
    );
    settings.backgroundRadiusPx = normalizeBackgroundRadius(
      backgroundRadiusInput.value || DEFAULT_SETTINGS.backgroundRadiusPx
    );

    settings.position = POSITION_VALUES.includes(position.value) ? position.value : DEFAULT_SETTINGS.position;

    if (sizeValue) sizeValue.textContent = (settings.sizePercent) + "%";
    if (colorOpacityValue) colorOpacityValue.textContent = (settings.colorOpacity) + "%";
    if (shadowOpacityValue) shadowOpacityValue.textContent = (settings.shadowOpacity) + "%";
    if (shadowSizeValue) shadowSizeValue.textContent = (settings.shadowSize) + "px";
    if (shadowDirectionValue) shadowDirectionValue.textContent = (settings.shadowDirection) + "°";
    if (backgroundOpacityValueText) backgroundOpacityValueText.textContent = (settings.backgroundOpacity) + "%";
    if (backgroundRadiusValueText) backgroundRadiusValueText.textContent = (settings.backgroundRadiusPx) + "px";
    renderPreview();
    renderDelayUi();
    onUpdate();
  };

  var emitDelayUpdate = function() {
    var parsed = Number(delayFocusRange.value);
    if (!Number.isFinite(parsed)) return;
    settings.delaySec =
      Math.round(clampNumber(parsed, -30, 30, DEFAULT_SETTINGS.delaySec) * 10) / 10;
    renderDelayUi();
    onUpdate();
  };

  var openDelayFocusMode = function(ev) {
    if (!(delayFocusPanel instanceof HTMLElement)) return;
    if (ev) {
      ev.preventDefault();
    }
    setDelayFocusMode(true);
  };

  size.addEventListener("input", emitUpdate);
  color.addEventListener("input", emitUpdate);
  colorOpacity.addEventListener("input", emitUpdate);
  colorOpacity.addEventListener("change", emitUpdate);
  font.addEventListener("change", emitUpdate);
  shadow.addEventListener("change", emitUpdate);
  shadowColor.addEventListener("input", emitUpdate);
  shadowColor.addEventListener("change", emitUpdate);
  shadowOpacity.addEventListener("input", emitUpdate);
  shadowOpacity.addEventListener("change", emitUpdate);
  shadowSize.addEventListener("input", emitUpdate);
  shadowSize.addEventListener("change", emitUpdate);
  shadowDirection.addEventListener("input", emitUpdate);
  shadowDirection.addEventListener("change", emitUpdate);
  backgroundEnabled.addEventListener("change", emitUpdate);
  backgroundColor.addEventListener("input", emitUpdate);
  backgroundColor.addEventListener("change", emitUpdate);
  backgroundOpacityInput.addEventListener("input", emitUpdate);
  backgroundOpacityInput.addEventListener("change", emitUpdate);
  backgroundRadiusInput.addEventListener("input", emitUpdate);
  backgroundRadiusInput.addEventListener("change", emitUpdate);
  position.addEventListener("change", emitUpdate);
  delayLaunch.addEventListener("click", openDelayFocusMode);
  delayLaunch.addEventListenerfunction("keydown", (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    openDelayFocusMode(ev);
  });
  delayFocusRange.addEventListener("input", emitDelayUpdate);
  delayFocusRange.addEventListener("change", emitDelayUpdate);
  delayFocusDone.addEventListenerfunction("click", () {
    setDelayFocusMode(false);
    delayLaunch.focus.();
  });
  delayFocusClose.addEventListenerfunction("click", () {
    close();
  });
  delayFocusReset.addEventListenerfunction("click", () {
    settings.delaySec = DEFAULT_SETTINGS.delaySec;
    renderDelayUi();
    onUpdate();
  });

  resetBtn.addEventListenerfunction("click", () {
    onReset();
    if (size) size.value = settings.sizePercent;
    if (sizeValue) sizeValue.textContent = (settings.sizePercent) + "%";
    if (color) color.value = settings.color;
    if (colorOpacity) colorOpacity.value = String(settings.colorOpacity);
    if (colorOpacityValue) colorOpacityValue.textContent = (settings.colorOpacity) + "%";
    if (font) font.value = settings.fontFamily;
    if (shadow) shadow.value = settings.dropShadow;
    if (shadowColor) shadowColor.value = settings.shadowColor;
    if (shadowOpacity) shadowOpacity.value = String(settings.shadowOpacity);
    if (shadowOpacityValue) shadowOpacityValue.textContent = (settings.shadowOpacity) + "%";
    if (shadowSize) shadowSize.value = String(settings.shadowSize);
    if (shadowSizeValue) shadowSizeValue.textContent = (settings.shadowSize) + "px";
    if (shadowDirection) shadowDirection.value = String(settings.shadowDirection);
    if (shadowDirectionValue) shadowDirectionValue.textContent = (settings.shadowDirection) + "°";
    if (backgroundEnabled) backgroundEnabled.checked = settings.backgroundEnabled;
    if (backgroundColor) backgroundColor.value = settings.backgroundColor;
    if (backgroundOpacityInput) backgroundOpacityInput.value = String(settings.backgroundOpacity);
    if (backgroundOpacityValueText) backgroundOpacityValueText.textContent = (settings.backgroundOpacity) + "%";
    if (backgroundRadiusInput) backgroundRadiusInput.value = String(settings.backgroundRadiusPx);
    if (backgroundRadiusValueText) backgroundRadiusValueText.textContent = (settings.backgroundRadiusPx) + "px";
    if (position) position.value = settings.position;
    renderDelayUi();
    setDelayFocusMode(false);
    renderPreview();
  });

  var originalClose = close;
  close = function() {
    setDelayFocusMode(false);
    originalClose();
  };

  setDelayFocusMode(false);
  renderDelayUi();
  renderPreview();
  return close;
}

function refreshTrack(track) {
    try {
      var prev = track.mode;
      track.mode = "disabled";
      track.mode = prev;
    } catch {}
  }

export function initSubtitleCustomizer() {
  if (window.__jmsSubtitleCustomizer.active) {
    return window.__jmsSubtitleCustomizer.destroy;
  }

  var settings = loadSettings();
  var observer = null;
  var closeDialog = null;
  var lastSaved = "";
  var lastComplexSubtitleRendererState = null;
  var lastAppliedDelay = settings.delaySec;
  var lastAppliedPosition = settings.position;
  var lastDidApplySubtitleDelay = false;
  var missingPlaybackTicks = 0;
  var lightApplyRafId = 0;
  var cueApplyRafId = 0;
  var heavyApplyTimeoutId = null;
  var liveSubtitleIntervalId = null;
  var hiddenWorkSuspended = document.hidden === true;

  var maybeAutoCloseDialog = function() {
    if (!closeDialog) {
      missingPlaybackTicks = 0;
      return;
    }
    if (isPlaybackScreenActive()) {
      missingPlaybackTicks = 0;
      return;
    }
    missingPlaybackTicks += 1;
    if (missingPlaybackTicks < 2) return;
    try {
      closeDialog();
    } catch {}
    closeDialog = null;
    missingPlaybackTicks = 0;
  };

  var applyNow = function(options = null) {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    hiddenWorkSuspended = false;

    var full = options.full !== false;
    var refreshStyles = options.refreshStyles !== false;
    var recomputeComplexRenderer =
      options.recomputeComplexRenderer !== false || lastComplexSubtitleRendererState === null;

    try {
      window.__jmsSubtitleCustomizerState = {
        settings: { ...settings }
      };
    } catch {}

    var hasAssSubtitleRenderer = recomputeComplexRenderer
      ? collectComplexSubtitleNodes().assNodes.length > 0
      : lastComplexSubtitleRendererState === true;

    if (full) {
      var serialized = JSON.stringify(settings);
      if (serialized !== lastSaved || hasAssSubtitleRenderer !== lastComplexSubtitleRendererState) {
        saveSettings(settings);
        saveJellyfinAppearance(settings, {
          suppressComplexTextSize: hasAssSubtitleRenderer
        });
        lastSaved = serialized;
        lastComplexSubtitleRendererState = hasAssSubtitleRenderer;
      }

      ensureClientSubtitleRenderingPreferences();
    }

    var playerRefreshState = full
      ? tryRefreshPlayerAppearance(settings)
      : { didApplySubtitleDelay: lastDidApplySubtitleDelay };
    lastDidApplySubtitleDelay = !!playerRefreshState.didApplySubtitleDelay;

    if (refreshStyles) {
      applyCueCss(settings);
      patchExistingCueStyles(settings);
      applyOverlayStyles(settings);
      applyComplexSubtitleStyles(settings);
    }

    var video = pickActiveVideo();
    if (!video) {
      restoreMirroredSubtitleTracks();
      clearSubtitleMirror(null, settings);
      return;
    }

    var subtitleTracks = getSubtitleTracks(video, false);
    var isMirroringTextSubtitles = syncSubtitleMirror(video, settings, {
      disabled: !settings.backgroundEnabled,
      hasComplexRenderer: hasAssSubtitleRenderer
    });
    var showingTracks = getShowingSubtitleTracks(video);

    var delayChanged = settings.delaySec !== lastAppliedDelay;
    var posChanged = settings.position !== lastAppliedPosition;
    var delayDeltaSec = settings.delaySec - lastAppliedDelay;
    var shouldUseCueDelayFallback = !playerRefreshState.didApplySubtitleDelay;
    var cueTimingChanged = false;

    subtitleTracks.forEach(function((track) {
      var changed = shiftTrackCueTimings(
        track,
        shouldUseCueDelayFallback ? settings.delaySec : DEFAULT_SETTINGS.delaySec
      );
      cueTimingChanged = cueTimingChanged || changed;
    });

    showingTracks.forEach(function((track) {
      var shouldRefreshTrack = cueTimingChanged;
      if (shiftTrackCues(track, settings)) {
        shouldRefreshTrack = true;
      }
      if (shouldRefreshTrack) refreshTrack(track);
    });

    if (delayChanged) lastAppliedDelay = settings.delaySec;
    if (posChanged) lastAppliedPosition = settings.position;

    try {
      window.__jmsSubtitleDelayDebug = {
        at: Date.now(),
        mode: full ? "full" : "light",
        delaySec: settings.delaySec,
        delayChanged,
        delayDeltaSec,
        shouldUseCueDelayFallback,
        cueTimingChanged,
        isMirroringTextSubtitles,
        showingTracks: showingTracks.length,
        subtitleTracks: subtitleTracks.length,
        playerRefreshState
      };
    } catch {}
  };

  var scheduleLightApply = function() {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    if (lightApplyRafId) return;
    lightApplyRafId = window.requestAnimationFramefunction(() {
      lightApplyRafId = 0;
      ensureButtons();
      applyOverlayStyles(settings);
      applyComplexSubtitleStyles(settings);
      maybeAutoCloseDialog();
    });
  };

  var scheduleCueApply = function() {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    if (cueApplyRafId) return;
    cueApplyRafId = window.requestAnimationFramefunction(() {
      cueApplyRafId = 0;
      applyNow({
        full: false,
        refreshStyles: false,
        recomputeComplexRenderer: false
      });
    });
  };

  var scheduleHeavyApply = function(delayMs = 80) {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    if (heavyApplyTimeoutId) {
      clearTimeout(heavyApplyTimeoutId);
    }
    heavyApplyTimeoutId = window.setTimeoutfunction(() {
      heavyApplyTimeoutId = null;
      applyNow();
    }, delayMs);
  };

  var runLiveSubtitleTick = function() {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }

    if (!isPlaybackScreenActive()) {
      maybeAutoCloseDialog();
      restoreMirroredSubtitleTracks();
      clearSubtitleMirror(null, settings);
      return;
    }

    applyNow({
      full: false,
      refreshStyles: false,
      recomputeComplexRenderer: false
    });
  };

  var stopLiveSubtitleTicker = function() {
    if (!liveSubtitleIntervalId) return;
    clearInterval(liveSubtitleIntervalId);
    liveSubtitleIntervalId = null;
  };

  var cancelScheduledApplies = function() {
    if (lightApplyRafId) {
      cancelAnimationFrame(lightApplyRafId);
      lightApplyRafId = 0;
    }
    if (cueApplyRafId) {
      cancelAnimationFrame(cueApplyRafId);
      cueApplyRafId = 0;
    }
    if (heavyApplyTimeoutId) {
      clearTimeout(heavyApplyTimeoutId);
      heavyApplyTimeoutId = null;
    }
  };

  var suspendHiddenSubtitleWork = function() {
    cancelScheduledApplies();
    stopLiveSubtitleTicker();
    if (hiddenWorkSuspended) return;
    hiddenWorkSuspended = true;
    maybeAutoCloseDialog();
    restoreMirroredSubtitleTracks();
    clearSubtitleMirror(null, settings);
  };

  var resumeHiddenSubtitleWork = function() {
    var wasSuspended = hiddenWorkSuspended;
    hiddenWorkSuspended = false;
    if (document.hidden) return;
    syncLiveSubtitleTicker();
    if (wasSuspended && isPlaybackScreenActive()) {
      scheduleHeavyApply(40);
    }
  };

  var startLiveSubtitleTicker = function() {
    if (liveSubtitleIntervalId) return;
    if (document.hidden) return;
    if (!isPlaybackScreenActive()) return;
    liveSubtitleIntervalId = window.setInterval(runLiveSubtitleTick, 250);
  };

  var syncLiveSubtitleTicker = function() {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }

    hiddenWorkSuspended = false;

    if (!isPlaybackScreenActive()) {
      stopLiveSubtitleTicker();
      maybeAutoCloseDialog();
      restoreMirroredSubtitleTracks();
      clearSubtitleMirror(null, settings);
      return;
    }

    startLiveSubtitleTicker();
  };

  var resetSettings = function() {
    var fallback = getDefaultSettingsFromJellyfin();

    settings.sizePercent = fallback.sizePercent || DEFAULT_SETTINGS.sizePercent;
    settings.color = fallback.color || DEFAULT_SETTINGS.color;
    settings.colorOpacity = normalizeColorOpacity(
      fallback.colorOpacity || DEFAULT_SETTINGS.colorOpacity
    );
    settings.fontFamily = normalizeFontFamilySelection(
      fallback.fontFamily,
      DEFAULT_SETTINGS.fontFamily
    );
    settings.dropShadow = fallback.dropShadow || DEFAULT_SETTINGS.dropShadow;
    settings.shadowColor = fallback.shadowColor || DEFAULT_SETTINGS.shadowColor;
    settings.shadowOpacity = normalizeShadowOpacity(
      fallback.shadowOpacity || DEFAULT_SETTINGS.shadowOpacity
    );
    settings.shadowSize = normalizeShadowSize(
      fallback.shadowSize || DEFAULT_SETTINGS.shadowSize
    );
    settings.shadowDirection = normalizeShadowDirection(
      fallback.shadowDirection || DEFAULT_SETTINGS.shadowDirection
    );
    settings.backgroundEnabled = normalizeBackgroundEnabled(
      fallback.backgroundEnabled || DEFAULT_SETTINGS.backgroundEnabled
    );
    settings.backgroundColor = fallback.backgroundColor || DEFAULT_SETTINGS.backgroundColor;
    settings.backgroundOpacity = normalizeBackgroundOpacity(
      fallback.backgroundOpacity || DEFAULT_SETTINGS.backgroundOpacity
    );
    settings.backgroundRadiusPx = normalizeBackgroundRadius(
      fallback.backgroundRadiusPx || DEFAULT_SETTINGS.backgroundRadiusPx
    );
    settings.delaySec = DEFAULT_SETTINGS.delaySec;
    settings.position = fallback.position || DEFAULT_SETTINGS.position;

    applyNow();
  };

  var openDialog = function() {
    if (closeDialog) {
      closeDialog();
      closeDialog = null;
    }
    closeDialog = createDialogfunction(settings, applyNow, resetSettings, () {
      closeDialog = null;
      missingPlaybackTicks = 0;
    });
  };

  var ensureButtons = function() {
    var controlBars = document.querySelectorAll(".videoOsdBottom.videoOsdBottom-maincontrols .buttons");
    controlBars.forEach(function((bar) {
      var subtitleBtn = bar.querySelector(".btnSubtitles");
      var btn = bar.querySelector("." + (BTN_CLASS));
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = subtitleBtn.className || "autoSize paper-icon-button-light";
        btn.classList.remove("btnSubtitles", "hide");
        btn.classList.add(BTN_CLASS, "autoSize");
        btn.setAttribute("is", subtitleBtn.getAttribute("is") || "paper-icon-button-light");
        btn.setAttribute("aria-label", L("subtitleCustomizerOpenButton", "Configurações de legenda"));
        btn.title = L("subtitleCustomizerOpenButton", "Configurações de legenda");
        btn.innerHTML = faIconHtml("sliders", "xlargePaperIconButton jms-subtitle-icon");
        btn.addEventListener("click", openDialog);

        if (subtitleBtn.parentElement === bar) {
          subtitleBtn.insertAdjacentElement("afterend", btn);
        } else {
          var audioBtn = bar.querySelector(".btnAudio");
          if (audioBtn.parentElement === bar) {
            audioBtn.insertAdjacentElement("beforebegin", btn);
          } else {
            bar.appendChild(btn);
          }
        }
      }
      var hidden = !!subtitleBtn.classList.contains("hide");
      btn.classList.toggle("hide", hidden);
    });
  };

  applyNow();
  ensureButtons();

  observer = new MutationObserverfunction((mutations) {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    syncLiveSubtitleTicker();
    if (!isRelevantSubtitleMutation(mutations)) return;
    scheduleLightApply();
    if (mutationNeedsHeavyRefresh(mutations)) {
      scheduleHeavyApply(120);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  var passiveApply = function() {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    syncLiveSubtitleTicker();
    scheduleHeavyApply(60);
  };
  var passiveCueApply = function() {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    scheduleCueApply();
  };
  document.addEventListener("play", passiveApply, true);
  document.addEventListener("loadedmetadata", passiveApply, true);
  document.addEventListener("cuechange", passiveCueApply, true);
  var routeApply = function() syncLiveSubtitleTicker();
  var visibilityApply = function() {
    if (document.hidden) {
      suspendHiddenSubtitleWork();
      return;
    }
    resumeHiddenSubtitleWork();
  };
  window.addEventListener("hashchange", routeApply, true);
  window.addEventListener("popstate", routeApply, true);
  document.addEventListener("visibilitychange", visibilityApply, true);
  syncLiveSubtitleTicker();

  var destroy = function() {
    try {
      observer.disconnect();
    } catch {}
    observer = null;

    cancelScheduledApplies();
    stopLiveSubtitleTicker();

    try {
      closeDialog.();
    } catch {}
    closeDialog = null;
    setSubtitleDialogOpenState(false);
    try { delete window.__jmsSubtitleCustomizerState; } catch {}
    unpatchAllPlayerSubtitleAppearance();
    restoreMirroredSubtitleTracks();
    document
      .querySelectorAll(".videoSubtitles[data-jms-subtitle-mirror='1']")
      .forEach(function((node) node.remove());
    nativeSubtitleUiOffsetCache = {
      slider: null,
      value: null
    };

    document.removeEventListener("play", passiveApply, true);
    document.removeEventListener("loadedmetadata", passiveApply, true);
    document.removeEventListener("cuechange", passiveCueApply, true);
    window.removeEventListener("hashchange", routeApply, true);
    window.removeEventListener("popstate", routeApply, true);
    document.removeEventListener("visibilitychange", visibilityApply, true);

    document.querySelectorAll("." + (BTN_CLASS)).forEach(function((btn) btn.remove());
    window.__jmsSubtitleCustomizer = { active: false, destroy: null };
  };

  window.__jmsSubtitleCustomizer = { active: true, destroy };
  return destroy;
}
