import { isDetailsModalModuleEnabled } from "./config.js";

let detailsModalModulePromise = null;

function resolveServerId(serverId = "") {
  const direct = String(serverId || "").trim();
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
  const explicitHref = String(detailsHref || "").trim();
  if (explicitHref) return explicitHref;

  const safeItemId = encodeURIComponent(String(itemId || "").trim());
  const safeServerId = encodeURIComponent(resolveServerId(serverId));
  return `#/details?id=${safeItemId}${safeServerId ? `&serverId=${safeServerId}` : ""}`;
}

export function navigateToDetailsPage(options = {}) {
  const itemId = String(options?.itemId || options?.item?.Id || "").trim();
  if (itemId) {
    if (typeof window.showItemDetailsPage === "function") {
      try {
        window.showItemDetailsPage(itemId);
        return true;
      } catch {}
    }
    const r = window.AppRouter || window.appRouter || window.router;
    if (r && typeof r.showItem === "function") {
      try {
        r.showItem(itemId);
        return true;
      } catch {}
    }
    try {
      const event = new CustomEvent("showItemDetails", { detail: { Id: itemId } });
      window.dispatchEvent(event);
      return true;
    } catch {}
  }

  const href = buildDetailsUrl(options);
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

export async function openDetailsModal(options = {}) {
  const resolvedItemId = String(options?.itemId || options?.item?.Id || "").trim();
  const resolvedDetailsHref = String(
    options?.detailsHref ||
    options?.item?.__detailsHref ||
    options?.item?.__tmdbPageUrl ||
    ""
  ).trim();
  if (!resolvedItemId && !options?.item) {
    if (resolvedDetailsHref) {
      navigateToDetailsPage({ ...options, detailsHref: resolvedDetailsHref });
      return { navigated: true, disabled: false };
    }
    return null;
  }

  const normalizedOptions = resolvedItemId && !options?.itemId
    ? { ...options, itemId: resolvedItemId }
    : options;

  if (!isDetailsModalModuleEnabled()) {
    navigateToDetailsPage({
      ...normalizedOptions,
      detailsHref: resolvedDetailsHref
    });
    return { navigated: true, disabled: true };
  }

  try {
    const { openDetailsModal: openDetailsModalInner } = await loadDetailsModalModule();
    return await openDetailsModalInner(normalizedOptions);
  } catch (error) {
    console.warn("detailsModalLoader fallback navigation:", error);
    navigateToDetailsPage({
      ...normalizedOptions,
      detailsHref: resolvedDetailsHref
    });
    return { navigated: true, error };
  }
}

export async function closeDetailsModalIfLoaded() {
  if (!detailsModalModulePromise) return null;

  try {
    const mod = await detailsModalModulePromise;
    return mod?.closeDetailsModal?.();
  } catch {
    return null;
  }
}
