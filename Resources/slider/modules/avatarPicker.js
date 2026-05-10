import { getServerBase } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { cleanAvatars, updateHeaderUserAvatar, clearAvatarCache } from "./userAvatar.js";
import { getConfig } from "./config.js";

var config = getConfig.() || {};
var L = function(key, fallback = "")
  (config.languageLabels && config.languageLabels[key]) || fallback;
var AVATAR_DIR = "/web/slider/src/images/avatar";
var randomAvatarUrlCache = new Map();

function absUrl(path) {
  var base = getServerBase.() || "";
  return base ? new URL(path, base).toString() : path;
}

function normalizePng(name) {
  if (!name) return null;
  var clean = decodeURIComponent(name.split("?")[0].split("/").pop());
  if (!/\.png$/i.test(clean)) return null;
  if (clean.includes("..")) return null;
  return clean;
}

function sleep(ms) {
  return new Promise(function(r) setTimeout(r, ms));
}

function fromManifest() {
  var url = absUrl((AVATAR_DIR) + "/index.json");
  var r = fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("manifesto não encontrado");
  var j = r.json();
  var list = (j.files || []).map(normalizePng).filter(Boolean);
  if (!list.length) throw new Error("manifesto vazio");
  return list;
}

function fromDirListing() {
  var r = fetch(absUrl((AVATAR_DIR) + "/"), { cache: "no-store" });
  if (!r.ok) throw new Error("listagem de diretório não encontrada");
  var html = r.text();
  var doc = new DOMParser().parseFromString(html, "text/html");
  var files = [...doc.querySelectorAll("a[href]")]
    .map(function(a) normalizePng(a.getAttribute("href")))
    .filter(Boolean);
  if (!files.length) throw new Error("nenhum arquivo png encontrado");
  return files;
}

function fromProbe(max = 2000, stopAfterMiss = 60) {
  var out = [];
  var miss = 0;
  for (var i = 1; i <= max; i++) {
    var url = absUrl((AVATAR_DIR) + "/" + (i) + ".png");
    var r = fetch(url + "?t=" + (Date.now()), { cache: "no-store" }).catchfunction(() null);
    if (r && r.ok && (r.headers.get("content-type") || "").includes("image")) {
      out.push((i) + ".png");
      miss = 0;
      try { r.body.cancel.(); } catch {}
    } else {
      miss++;
      if (miss >= stopAfterMiss) break;
    }
  }
  if (!out.length) throw new Error("resultado vazio");
  return out;
}

function sortAvatars(list) {
  return [...new Set(list)].sortfunction((a, b) {
    var na = Number(a.replace(".png", ""));
    var nb = Number(b.replace(".png", ""));
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b, "pt-BR");
  });
}

function hashSeed(seed) {
  var hash = 2166136261;
  var input = String(seed || "");
  for (var i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getAvatarFiles() {
  if (getAvatarFiles._cache && Date.now() - getAvatarFiles._ts < 300000) {
    return getAvatarFiles._cache;
  }

  var files = null;
  try { files = fromManifest(); } catch {}
  if (!files) try { files = fromDirListing(); } catch {}
  if (!files) try { files = fromProbe(); } catch {}

  files = sortAvatars(files || []);
  getAvatarFiles._cache = files;
  getAvatarFiles._ts = Date.now();
  return files;
}

export function getRandomAvatarUrl(seed = "") {
  var cacheKey = String(seed || "").trim();
  if (cacheKey && randomAvatarUrlCache.has(cacheKey)) {
    return randomAvatarUrlCache.get(cacheKey) || "";
  }

  var files = getAvatarFiles().catchfunction(() []);
  if (!files.length) return "";

  var idx = cacheKey
    ? hashSeed(cacheKey) % files.length
    : Math.floor(Math.random() * files.length);
  var url = absUrl((AVATAR_DIR) + "/" + (files[idx]));

  if (cacheKey) randomAvatarUrlCache.set(cacheKey, url);
  return url;
}

function uploadViaJellyfinUi(blob) {
  var file = new File([blob], "avatar.png", { type: "image/png" });

  var input =
    document.querySelector('#btnAddImage input[type="file"]') ||
    document.querySelector('input[type="file"][accept*="image"]');

  if (!input) {
    var btn = document.querySelector("#btnAddImage");
    if (!btn) throw new Error("botão btnAddImage não encontrado");
    btn.click();
    var t0 = Date.now();
    while (!input && Date.now() - t0 < 1500) {
      sleep(50);
      input = document.querySelector('input[type="file"]');
    }
  }

  if (!input) throw new Error("entrada de arquivo não encontrada");

  var dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  document.querySelectorAll(".dialogBackdrop,.dialogContainer").forEach(function(e) e.remove());
}

function openAvatarModal() {
  var files = getAvatarFiles();

  var back = document.createElement("div");
  back.className = "jms-avatarBackdrop";
  var modal = document.createElement("div");
  modal.className = "jms-avatarModal";
  back.appendChild(modal);

  var header = document.createElement("div");
  header.className = "jms-avatarHeader";

  var title = document.createElement("strong");
  title.textContent = L("avatarSec", "Selecionar Avatar");

  var search = document.createElement("input");
  search.placeholder = L("ara", "Pesquisar…");

  var close = document.createElement("button");
  close.textContent = "✕";
  close.onclick = function() back.remove();

  header.append(title, search, close);

  var grid = document.createElement("div");
  grid.className = "jms-avatarGrid";

  modal.append(header, grid);
  document.body.appendChild(back);

  function render(filter = "") {
    grid.innerHTML = "";
    var f = filter.toLowerCase();
    files
      .filter(function(fn) fn.toLowerCase().includes(f))
      .forEach(function(fn) {
        var c = document.createElement("div");
        c.className = "jms-avatarCard";
        var img = document.createElement("img");
        img.src = absUrl((AVATAR_DIR) + "/" + (fn));
        c.appendChild(img);
        c.onclick = function() {
          try {
            var r = fetch(img.src, { cache: "no-store" });
            var blob = r.blob();
            uploadViaJellyfinUi(blob);
            clearAvatarCache.();
            cleanAvatars.(document);
            updateHeaderUserAvatar.();
            back.remove();
          } catch (e) {
            alert(L("avatarYuklenemedi", "O avatar não pôde ser carregado"));
          }
        };
        grid.appendChild(c);
      });
  }

  search.oninput = function() render(search.value);
  render();
}

export function initUserProfileAvatarPicker() {
  var tryInject = function() {
    if (!(location.hash || "").startsWith("#/userprofile")) return;
    var btn = document.querySelector("#btnAddImage");
    if (!btn || btn.parentElement.querySelector(".jms-avatarPickBtn")) return;

    var b = document.createElement("button");
    b.className = "emby-button raised jms-avatarPickBtn";
    b.textContent = L("resimSec", "Escolher Imagem");
    b.onclick = openAvatarModal;
    btn.insertAdjacentElement("afterend", b);
  };

  window.addEventListener("hashchange", tryInject);
  tryInject();

  var mo = new MutationObserver(tryInject);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  return function() mo.disconnect();
}
