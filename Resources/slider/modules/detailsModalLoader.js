import { isDetailsModalModuleEnabled } from "./config.js";

var detailsModalModulePromise = null;

function resolveServerId(serverId = "") {
  var direct = String(serverId || "").trim();
  if (direct) return direct;

  return String(
    localStorage.getItem("persist_server_id") ||
    sessionStorage.getItem("persist_server_id") ||
    localStorage.getItem("serverId") ||
    sessionStorage.getItem("serverId") ||
    ""
  ).trim();
}

function buildDetailsUrl({ itemId, serverId = "", detailsHref = "" } = {}) {
  var explicitHref = String(detailsHref || "").trim();
  if (explicitHref) return explicitHref;

  var safeItemId = encodeURIComponent(String(itemId || "").trim());
  var safeServerId = encodeURIComponent(resolveServerId(serverId));
  return "#/details?id=" + (safeItemId) + "${safeServerId ? "&serverId=${safeServerId}" : \"\"}";
}

export function navigateToDetailsPage(options = {}) {
  var href = buildDetailsUrl(options);
  if (!href) return false;

  try {
    if (href.startsWith("#")) {
      window.location.hash = href.slice(1);
    } else {
      window.location.href = href;
    }
    return true;
  } catch {
    return false;
  }
}

function loadDetailsModalModule() {
  return detailsModalModulePromise || (detailsModalModulePromise = import("./detailsModal.js"));
}

export function openDetailsModal(options = {}) {
  if (!options.itemId) return null;

  if (!isDetailsModalModuleEnabled()) {
    navigateToDetailsPage(options);
    return { navigated: true, disabled: true };
  }

  try {
    var { openDetailsModal: openDetailsModalInner } = loadDetailsModalModule();
    return openDetailsModalInner(options);
  } catch (error) {
    console.warn("detailsModalLoader fallback navigation:", error);
    navigateToDetailsPage(options);
    return { navigated: true, error };
  }
}

export function closeDetailsModalIfLoaded() {
  if (!detailsModalModulePromise) return null;

  try {
    var mod = detailsModalModulePromise;
    return mod.closeDetailsModal.();
  } catch {
    return null;
  }
}
