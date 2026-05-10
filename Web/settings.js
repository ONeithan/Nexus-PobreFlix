function getJfRootFromLocation() {
  try {
    const baseElement = document.querySelector("base[href]");
    const baseHref = baseElement ? baseElement.getAttribute("href") : null;
    if (baseHref) {
      const url = new URL(baseHref, window.location.href);
      return String(url.pathname || "")
        .replace(/\/web\/?$/i, "")
        .replace(/\/+$/, "");
    }
  } catch (e) {}

  const path = String(window.location.pathname || "/");
  const match = path.match(/^(.*?)(?:\/web(?:\/|$).*)$/i);
  return (match && match[1]) ? match[1].replace(/\/+$/, "") : "";
}

const jfRoot = getJfRootFromLocation();
const settingsPageModuleUrl = String(window.location.origin) + String(jfRoot) + "/slider/modules/settingsPage.js";

async function loadSettingsPageModule() {
  return import(settingsPageModuleUrl);
}

export async function mountNexusPobreFlixSettingsPage(host, options) {
  const params = options || {};
  const mod = await loadSettingsPageModule();
  if (!mod || typeof mod.mountNexusPobreFlixSettingsPage !== "function") {
    throw new Error("Nexus PobreFlix settings page module is not available.");
  }
  return mod.mountNexusPobreFlixSettingsPage(host, params);
}
