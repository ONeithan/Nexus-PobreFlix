function getJfRootFromLocation() {
  try {
    var baseElement = document.querySelector("base[href]");
    var baseHref = baseElement ? baseElement.getAttribute("href") : null;
    if (baseHref) {
      var url = new URL(baseHref, window.location.href);
      return String(url.pathname || "")
        .replace(/\/web\/?$/i, "")
        .replace(/\/+$/, "");
    }
  } catch (e) {}

  var path = String(window.location.pathname || "/");
  var match = path.match(/^(.*?)(?:\/web(?:\/|$).*)$/i);
  return (match && match[1]) ? match[1].replace(/\/+$/, "") : "";
}

var jfRoot = getJfRootFromLocation();
var settingsPageModuleUrl = String(window.location.origin) + String(jfRoot) + "/slider/modules/settingsPage.js";

function loadSettingsPageModule() {
  // Fallback para navegadores que não suportam import() dinâmico
  if (typeof import !== "undefined") {
    return import(settingsPageModuleUrl);
  }
  
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = settingsPageModuleUrl;
    script.type = 'text/javascript';
    script.onload = function() {
       // Se o settingsPage.js definir algo global, pegamos daqui.
       // Mas o Nexus usa export, então precisamos de um wrapper ou mudar o settingsPage.js para definir global.
       resolve(window.NexusPobreFlixSettingsModule); 
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Alterando para exportação compatível com o Jellyfin mas usando sintaxe ES5 interna
export function mountNexusPobreFlixSettingsPage(host, options) {
  var params = options || {};
  
  return loadSettingsPageModule().then(function(mod) {
    if (!mod || typeof mod.mountNexusPobreFlixSettingsPage !== "function") {
      throw new Error("Nexus PobreFlix settings page module is not available.");
    }
    return mod.mountNexusPobreFlixSettingsPage(host, params);
  });
}
