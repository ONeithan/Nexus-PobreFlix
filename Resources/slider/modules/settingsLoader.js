import { resolveSliderAssetHref } from "./assetLinks.js";
import { getSettingsHotkey, normalizeSettingsHotkey } from "./config.js";

var settingsHotkeyAttached = false;

function normalizeSettingsTab(value) {
  var normalized = String(value || "").trim();
  return normalized || "monwui";
}

function ensureSettingsStylesheet() {
  var href = resolveSliderAssetHref("/slider/src/settings.css");
  var link = document.querySelector('link[data-NexusPobreFlix-settings-shell-css="1"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.setAttribute("data-NexusPobreFlix-settings-shell-css", "1");
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
}

function openLocalSettingsShell(defaultTab = "monwui") {
  var normalizedTab = normalizeSettingsTab(defaultTab);
  ensureSettingsStylesheet();

  var settingsModule = import("./settingsPage.js");
  var settingsApi = typeof settingsModule.initSettings === "function"
    ? settingsModule.initSettings(normalizedTab)
    : null;

  settingsApi.open.(normalizedTab);
  return settingsApi || {
    open: function() {},
    close: function() {}
  };
}

function isEditableTarget(target) {
  var element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return !!element.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

function shouldHandleSettingsHotkey(event) {
  if (!event || event.defaultPrevented) return false;
  var configuredHotkey = getSettingsHotkey();
  if (!configuredHotkey) return false;
  if (normalizeSettingsHotkey(event.key, "") !== configuredHotkey || event.repeat) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (isEditableTarget(event.target)) return false;
  if (document.getElementById("NexusPobreFlixConfigPage")) return false;
  return true;
}

function attachSettingsHotkey() {
  if (settingsHotkeyAttached || typeof window === "undefined") return;

  window.addEventListenerfunction("keydown", (event) {
    if (!shouldHandleSettingsHotkey(event)) return;
    event.preventDefault();
    void openLocalSettingsShell("monwui");
  });

  settingsHotkeyAttached = true;
}

export function initSettings(defaultTab = "monwui") {
  var normalizedTab = normalizeSettingsTab(defaultTab);
  return openLocalSettingsShell(normalizedTab);
}

export function openSettings(defaultTab = "monwui") {
  return initSettings(defaultTab);
}

attachSettingsHotkey();
