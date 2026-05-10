(function () {
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
  var langModuleUrl = String(window.location.origin) + String(jfRoot) + "/slider/language/index.js";
  var webSettingsModuleUrl = String(window.location.origin) + String(jfRoot) + "/Plugins/NexusPobreFlix/assets/settings.js";
  var sliderSettingsCssUrl = String(window.location.origin) + String(jfRoot) + "/slider/src/settings.css";
  var TAB_STORAGE_KEY = "NexusPobreFlix-config-active-tab";
  var NEXUS_SUBTAB_STORAGE_KEY = "NexusPobreFlix-requested-subtab";

  var api = function(p) { return String(jfRoot || "") + "/Plugins/NexusPobreFlix/" + String(p); };
  var esc = function(s) {
    var val = (s === null || s === undefined) ? "" : s;
    return val.toString().replace(/[&<>]/g, function(m) {
       var entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
       return entities[m];
    });
  };

  var fallbackLabels = {
    webConfig: {
      heroEyebrow: "Configuração do Plugin",
      heroTitle: "Nexus PobreFlix — Painel de Controle",
      heroBody: "Gerencie os assets do slider, publique configurações globais, inspecione o status em tempo real e revise detalhes de permissões em uma única tela.",
      heroLangLabel: "Idioma Selecionado",
      heroRootLabel: "Raiz da UI Web",
      tabs: {
        NexusPobreFlix: "Nexus PobreFlix",
        NexusPobreFlixSettings: "Configurações Nexus PobreFlix",
        status: "Status",
        snippet: "HTML Snippet & Permissões"
      },
      sections: {
        configTitle: "Configurações Principais",
        configBody: "Escolha de onde o Nexus PobreFlix serve os assets do slider.",
        adminTitle: "Ações de Administrador",
        adminBody: "Salve as configurações ou publique o snapshot global para todos os perfis.",
        statusTitle: "Status em Tempo Real",
        statusBody: "Verificação rápida do estado de configuração e fallback de assets.",
        inMemoryTitle: "Injeção em Memória",
        inMemoryBody: "Verifica se o index.html está sendo reescrito em tempo de execução sem tocar nos arquivos no disco.",
        NexusPobreFlixSettingsTitle: "Configurações Nexus PobreFlix",
        snippetTitle: "HTML Snippet",
        snippetBody: "O snippet exato que o Nexus PobreFlix injeta no Jellyfin web.",
        envTitle: "Caminho Web & Permissões",
        envBody: "Raiz web detectada, permissões de escrita e comandos ACL sugeridos."
      },
      fields: {
        forceGlobalLabel: "Forçar configurações globais",
        forceGlobalHint: "Ativado: todos os usuários recebem o snapshot do admin automaticamente. Desativado: usuários mantêm suas próprias configurações locais.",
        scriptDirLabel: "Diretório de scripts",
        scriptDirPlaceholder: "/home/nexus/slider",
        scriptDirHint: "Deixe em branco para usar os assets embutidos em <code>/Resources/slider</code>.",
        playerSubLabel: "Subdiretório do player",
        playerSubPlaceholder: "modules/player"
      },
      actions: {
        save: "Salvar",
        publishGlobal: "Publicar configurações globalmente",
        reloadNexusPobreFlixSettings: "Recarregar Configurações Nexus PobreFlix",
        refreshEnv: "Atualizar Caminho Web & Permissões",
        copyAcl: "Copiar comandos de permissão",
        patch: "Aplicar patch no index.html",
        unpatch: "Remover patch do index.html"
      },
      messages: {
        settingsSaved: "Configurações salvas.",
        configLoadFailed: "Não foi possível carregar as configurações.",
        webPathUpdated: "Caminho web e permissões atualizados.",
        nothingToCopy: "Não há nada para copiar.",
        commandsCopied: "Comandos de permissão copiados.",
        patchDone: "Patch concluído.",
        unpatchDone: "Patch removido.",
        publishDone: "Configurações globais publicadas com sucesso.",
        physicalPatchFallbackEnabled: "Fallback de patch físico habilitado.",
        physicalPatchFallbackDisabled: "Fallback de patch físico desabilitado.",
        statusPending: "O status ainda não foi carregado.",
        snippetPending: "O snippet ainda não foi carregado.",
        NexusPobreFlixSettingsLoading: "Carregando configurações Nexus PobreFlix...",
        NexusPobreFlixSettingsLoadFailed: "Não foi possível carregar as configurações Nexus PobreFlix.",
        inMemoryChecking: "Verificando injeção em memória...",
        envPending: "(ainda não computado)"
      },
      status: {
        configured: "Configurado",
        directoryExists: "Diretório existe",
        mainJsExists: "Main JS existe",
        playerJsExists: "Player JS existe",
        usingEmbedded: "Usando assets embutidos",
        playerPath: "Caminho do player resolvido",
        yes: "Sim",
        no: "Não"
      },
      inMemory: {
        activeTitle: "Injeção em memória está ativa.",
        activeHint: "O patch físico não é necessário enquanto a injeção em tempo real funcionar.",
        inactiveTitle: "Injeção em memória não detectada.",
        inactiveHint: "Use o Patch se quiser persistir o snippet no index.html.",
        fallbackToggleLabel: "Habilitar patch físico de fallback no index.html",
        fallbackToggleHint: "Desativado por padrão. Habilite apenas se a injeção em tempo real não funcionar ou se precisar explicitamente do patch no disco."
      },
      env: {
        runningUser: "Usuário em execução",
        detectedWebRoot: "Raiz web detectada",
        files: "Arquivos",
        found: "Encontrado",
        notFound: "Não encontrado",
        writable: "Gravável",
        notWritable: "Sem permissão de escrita",
        suggestedAcl: "Comandos ACL sugeridos",
        alternativeAcl: "Alternativo"
      }
    }
  };

  var state = {
    labels: fallbackLabels,
    lang: "eng"
  };

  function getByPath(obj, pathExpr) {
    return String(pathExpr || "")
      .split(".")
      .reduce(function(acc, key) { return (acc && acc[key] != null ? acc[key] : null); }, obj);
  }

  function t(pathExpr, fallback) {
    if (fallback === undefined) fallback = "";
    var value = getByPath(state.labels, pathExpr);
    return value == null ? fallback : value;
  }

  function setText(view, selector, text) {
    var el = view.querySelector(selector);
    if (el) el.textContent = text;
  }

  function setHtml(view, selector, html) {
    var el = view.querySelector(selector);
    if (el) el.innerHTML = html;
  }

  function setPlaceholder(view, selector, text) {
    var el = view.querySelector(selector);
    if (el) el.setAttribute("placeholder", text);
  }

  function ensureStylesheet(key, href) {
    var link = document.querySelector('link[data-nexus-config-css="' + String(key) + '"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-nexus-config-css", key);
      document.head.appendChild(link);
    }
    if (link.href !== href) {
      link.href = href;
    }
    return link;
  }

  function getLanguageDisplayName(code) {
    var map = {
      tur: "Turkce",
      eng: "English",
      deu: "Deutsch",
      fre: "Francais",
      rus: "Русский",
      spa: "Español",
      por: "Português (Brasil)"
    };
    return map[code] || String(code || "").toUpperCase() || "Auto";
  }

  function webRootLabel() {
    return (jfRoot || "") + "/web" || "/web";
  }

  function loadLanguagePack() {
    return (function() {
      if (typeof import !== "undefined") {
         return import(langModuleUrl);
      }
      return Promise.reject("ESM not supported");
    })()
      .then(function(mod) {
        var lang = typeof mod.getEffectiveLanguage === "function"
          ? mod.getEffectiveLanguage()
          : (typeof mod.detectBrowserLanguage === "function" ? mod.detectBrowserLanguage() : "eng");
        var labels = typeof mod.getLanguageLabels === "function"
          ? mod.getLanguageLabels(lang)
          : null;

        if (labels) {
          state.labels = labels;
          state.lang = lang || "eng";
        }
      })
      .catch(function() {
        state.labels = fallbackLabels;
        state.lang = "eng";
      });
  }

  function showMessage(view, text, kind) {
    if (kind === undefined) kind = "";
    var el = view.querySelector("#msg");
    if (!el) return;
    el.className = ("fieldDescription " + String(kind)).trim();
    el.textContent = text;
    clearTimeout(el.__t);
    el.__t = setTimeout(function() {
      el.textContent = "";
      el.className = "fieldDescription";
    }, 3200);
  }

  function renderNexusPobreFlixSettingsPlaceholder(view, text, tone) {
    if (tone === undefined) tone = "";
    var host = view.querySelector("#NexusPobreFlixSettingsHost");
    if (!host) return;

    var placeholder = document.createElement("div");
    placeholder.id = "NexusPobreFlixSettingsPlaceholder";
    placeholder.className = ("nexus-empty " + (tone ? "nexus-empty--" + String(tone) : "")).trim();
    placeholder.textContent = text;
    host.replaceChildren(placeholder);
  }

  function consumeRequestedNexusPobreFlixSettingsTab() {
    var value = "";
    try {
      value = sessionStorage.getItem(NEXUS_SUBTAB_STORAGE_KEY) || "";
      if (value) sessionStorage.removeItem(NEXUS_SUBTAB_STORAGE_KEY);
    } catch (e) {}
    return String(value || "").trim() || "NexusPobreFlix";
  }

  function ensureNexusPobreFlixSettings(view, opts) {
    var force = (opts && opts.force === true);
    var host = view.querySelector("#NexusPobreFlixSettingsHost");
    var reloadBtn = view.querySelector("#reloadNexusPobreFlixSettingsBtn");
    if (!host) return Promise.resolve(null);

    var requestedInnerTab = consumeRequestedNexusPobreFlixSettingsTab();

    if (!force && host.__nexusReady && host.querySelector("#settings-modal")) {
      var existingApi = host.__nexusApi || host.__nexusSettingsApi || null;
      if (existingApi && typeof existingApi.open === "function") {
        existingApi.open(requestedInnerTab);
      }
      return Promise.resolve(host.querySelector("#settings-modal"));
    }

    if (host.__nexusPromise) {
      return host.__nexusPromise;
    }

    host.__nexusReady = false;
    renderNexusPobreFlixSettingsPlaceholder(
      view,
      t("webConfig.messages.NexusPobreFlixSettingsLoading", "Nexus PobreFlix settings are loading...")
    );
    if (reloadBtn) reloadBtn.disabled = true;

    host.__nexusPromise = (function() {
      ensureStylesheet("NexusPobreFlix-settings", sliderSettingsCssUrl);

      return (function() {
        if (typeof import !== "undefined") {
          return import(webSettingsModuleUrl);
        }
        return Promise.reject("ESM not supported");
      })().then(function(settingsModule) {
        if (settingsModule && typeof settingsModule.mountNexusPobreFlixSettingsPage === "function") {
           return settingsModule.mountNexusPobreFlixSettingsPage(host, {
              defaultTab: requestedInnerTab,
              force: force
           });
        }
        return null;
      }).then(function(settingsApi) {
        var modal = (settingsApi && settingsApi.element) || host.querySelector("#settings-modal");

        if (!modal || !settingsApi) {
          throw new Error("Nexus PobreFlix settings page is not available.");
        }

        host.__nexusApi = settingsApi;
        host.__nexusReady = true;
        view.__NexusPobreFlixSettingsLoaded = true;
        return modal;
      });
    })()
      .catch(function(error) {
        var fallback = t("webConfig.messages.NexusPobreFlixSettingsLoadFailed", "Nexus PobreFlix settings could not be loaded.");
        var detail = String((error && error.message) || "").trim();
        renderNexusPobreFlixSettingsPlaceholder(view, detail ? String(fallback) + " " + String(detail) : fallback, "error");
        throw error;
      })
      .finally(function() {
        host.__nexusPromise = null;
        if (reloadBtn) reloadBtn.disabled = false;
      });

    return host.__nexusPromise;
  }

  function activateTab(view, tabName) {
    var tabs = view.querySelectorAll(".nexus-tab");
    for (var i = 0; i < tabs.length; i++) {
       var tab = tabs[i];
       var active = tab.dataset.tab === tabName;
       tab.classList.toggle("is-active", active);
       tab.setAttribute("aria-selected", active ? "true" : "false");
    }

    var panels = view.querySelectorAll(".nexus-panel");
    for (var j = 0; j < panels.length; j++) {
       var panel = panels[j];
       var pActive = panel.dataset.panel === tabName;
       panel.classList.toggle("is-active", pActive);
       panel.hidden = !pActive;
    }

    try {
      localStorage.setItem(TAB_STORAGE_KEY, tabName);
    } catch (e) {}

    if (tabName === "NexusPobreFlix-settings") {
      ensureNexusPobreFlixSettings(view).catch(function(error) {
        console.error("Nexus PobreFlix settings load failed:", error);
      });
    }
  }

  function initTabs(view) {
    if (view.__nexus_tabs_bound) return;
    view.__nexus_tabs_bound = true;

    var tabs = view.querySelectorAll(".nexus-tab");
    for (var i = 0; i < tabs.length; i++) {
      (function(tab) {
        tab.addEventListener("click", function() {
          activateTab(view, tab.dataset.tab || "NexusPobreFlix");
        });
      })(tabs[i]);
    }

    var active = "NexusPobreFlix";
    try {
      var stored = localStorage.getItem(TAB_STORAGE_KEY);
      if (stored && (stored === "NexusPobreFlix" || stored === "NexusPobreFlix-settings" || stored === "status" || stored === "snippet")) {
        active = stored;
      }
    } catch (e) {}
    activateTab(view, active);
  }

  function applyTranslations(view) {
    setText(view, "#heroEyebrow", t("webConfig.heroEyebrow", "Plugin Configuration"));
    setText(view, "#pageTitle", t("webConfig.heroTitle", "NexusPobreFlix Control Center"));
    setHtml(view, "#pageIntro", t("webConfig.heroBody", fallbackLabels.webConfig.heroBody));
    setText(view, "#heroLangLabel", t("webConfig.heroLangLabel", "Selected Language"));
    setText(view, "#heroLangValue", getLanguageDisplayName(state.lang));
    setText(view, "#heroRootLabel", t("webConfig.heroRootLabel", "Web UI Root"));
    setText(view, "#heroRootValue", webRootLabel());

    setText(view, "#tabNexusPobreFlix", t("webConfig.tabs.NexusPobreFlix", "NexusPobreFlix"));
    setText(view, "#tabNexusPobreFlixSettings", t("webConfig.tabs.NexusPobreFlixSettings", "Configurações Nexus PobreFlix"));
    setText(view, "#tabStatus", t("webConfig.tabs.status", "Status"));
    setText(view, "#tabSnippet", t("webConfig.tabs.snippet", "HTML Snippet & Web Path & Permissions"));

    setText(view, "#configCardTitle", t("webConfig.sections.configTitle", "Core Settings"));
    setText(view, "#configCardBody", t("webConfig.sections.configBody", "Choose where NexusPobreFlix serves slider assets from and how the player module path is resolved."));
    setText(view, "#actionsCardTitle", t("webConfig.sections.adminTitle", "Admin Actions"));
    setText(view, "#actionsCardBody", t("webConfig.sections.adminBody", "Save plugin settings or publish the current admin snapshot globally for every user profile."));
    setText(view, "#NexusPobreFlixSettingsCardTitle", t("webConfig.sections.NexusPobreFlixSettingsTitle", "Nexus PobreFlix Settings"));
    setText(view, "#statusCardTitle", t("webConfig.sections.statusTitle", "Runtime Status"));
    setText(view, "#statusCardBody", t("webConfig.sections.statusBody", "Quick verification for configuration state, player path resolution, and embedded asset fallback."));
    setText(view, "#inmemCardTitle", t("webConfig.sections.inMemoryTitle", "In-Memory Injection"));
    setText(view, "#inmemCardBody", t("webConfig.sections.inMemoryBody", "Checks whether index.html is being rewritten at response time without touching files on disk."));
    setText(view, "#snippetCardTitle", t("webConfig.sections.snippetTitle", "HTML Snippet"));
    setText(view, "#snippetCardBody", t("webConfig.sections.snippetBody", "The exact snippet NexusPobreFlix injects into Jellyfin web."));
    setText(view, "#envCardTitle", t("webConfig.sections.envTitle", "Web Path & Permissions"));
    setText(view, "#envCardBody", t("webConfig.sections.envBody", "Detected web root, file write permissions, and suggested ACL commands for patching."));

    setText(view, "#forceGlobalLabel", t("webConfig.fields.forceGlobalLabel", "Force global user settings"));
    setText(view, "#forceGlobalHint", t("webConfig.fields.forceGlobalHint", "Enabled: all users receive the admin snapshot automatically. Disabled: users keep their own local settings."));
    setText(view, "#scriptDirLabel", t("webConfig.fields.scriptDirLabel", "Script directory"));
    setPlaceholder(view, "#scriptDir", t("webConfig.fields.scriptDirPlaceholder", "/home/nexus/slider"));
    setHtml(view, "#scriptDirHint", t("webConfig.fields.scriptDirHint", "Leave empty to use embedded <code>/Resources/slider</code> assets."));
    setText(view, "#playerSubLabel", t("webConfig.fields.playerSubLabel", "Player subdirectory"));
    setPlaceholder(view, "#playerSub", t("webConfig.fields.playerSubPlaceholder", "modules/player"));

    setText(view, "#saveBtn", t("webConfig.actions.save", "Save"));
    setText(view, "#publishGlobalBtn", t("webConfig.actions.publishGlobal", "Publish admin settings globally"));
    setText(view, "#reloadNexusPobreFlixSettingsBtn", t("webConfig.actions.reloadNexusPobreFlixSettings", "Reload Nexus PobreFlix Settings"));
    setText(view, "#refreshEnvBtn", t("webConfig.actions.refreshEnv", "Refresh Web Path & Permissions"));
    setText(view, "#copyAclBtn", t("webConfig.actions.copyAcl", "Copy permission commands"));
    setText(view, "#patchBtn", t("webConfig.actions.patch", "Patch index.html"));
    setText(view, "#unpatchBtn", t("webConfig.actions.unpatch", "Unpatch index.html"));

    setText(view, "#envUserLabel", t("webConfig.env.runningUser", "Running user"));
    setText(view, "#envWebRootLabel", t("webConfig.env.detectedWebRoot", "Detected web root"));
    setText(view, "#envFilesLabel", t("webConfig.env.files", "Files"));
    setText(view, "#envAclLabel", t("webConfig.env.suggestedAcl", "Suggested ACL commands"));

    if (!view.__statusData) {
      setText(view, "#statusPlaceholder", t("webConfig.messages.statusPending", "Status has not been loaded yet."));
    }
    if (!view.__snippetLoaded) {
      setText(view, "#snippetPlaceholder", t("webConfig.messages.snippetPending", "Snippet has not been loaded yet."));
    }
    if (typeof view.__inmemOk !== "boolean") {
      setText(view, "#inmem", t("webConfig.messages.inMemoryChecking", "Checking in-memory injection..."));
    }
    if (!view.__envData) {
      setText(view, "#envAcl", t("webConfig.messages.envPending", "(not computed yet)"));
    }
    if (!view.__NexusPobreFlixSettingsLoaded && !view.querySelector("#NexusPobreFlixSettingsHost #settings-modal")) {
      renderNexusPobreFlixSettingsPlaceholder(
        view,
        t("webConfig.messages.NexusPobreFlixSettingsLoading", "Nexus PobreFlix settings are loading...")
      );
    }

    if (view.__statusData) renderStatus(view, view.__statusData);
    if (view.__envData) renderEnv(view, view.__envData);
    if (typeof view.__inmemOk === "boolean") renderInMem(view, view.__inmemOk);
  }

  function loadConfig(view) {
    return fetch(api("Configuration"))
      .then(function(r) {
        if (!r.ok) throw new Error("Failed to load config: " + r.status);
        return r.json();
      })
      .then(function(cfg) {
        view.__physicalPatchFallbackEnabled = !!cfg.enablePhysicalIndexHtmlPatchFallback;
        view.querySelector("#scriptDir").value = cfg.scriptDirectory || "";
        view.querySelector("#playerSub").value = cfg.playerSubdir || "modules/player";
        var fg = view.querySelector("#forceGlobal");
        if (fg) fg.checked = !!cfg.forceGlobalUserSettings;
        return cfg;
      });
  }

  function postConfiguration(body) {
    return fetch(api("Configuration"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) {
        return r.text().then(function(txt) {
          throw new Error("Save failed: " + r.status + " - " + txt);
        });
      }
    });
  }

  function saveConfig(view) {
    var body = {
      scriptDirectory: view.querySelector("#scriptDir").value.trim(),
      playerSubdir: view.querySelector("#playerSub").value.trim(),
      forceGlobalUserSettings: !!(view.querySelector("#forceGlobal") && view.querySelector("#forceGlobal").checked)
    };

    return postConfiguration(body);
  }

  function getStatus() {
    return fetch(api("Status"))
      .then(function(r) {
        if (!r.ok) throw new Error("Failed to get status: " + r.status);
        return r.json();
      });
  }

  function statusBadge(text, tone) {
    if (tone === undefined) tone = "is-good";
    return '<span class="nexus-badge ' + String(tone) + '">' + esc(text) + '</span>';
  }

  function yesNo(value) {
    return value
      ? t("webConfig.status.yes", "Yes")
      : t("webConfig.status.no", "No");
  }

  function renderStatus(view, s) {
    view.__statusData = s;
    var el = view.querySelector("#status");
    if (!el) return;

    var rows = [
      {
        label: t("webConfig.status.configured", "Configured"),
        value: statusBadge(yesNo(s.configured), s.configured ? "is-good" : "is-bad")
      },
      {
        label: t("webConfig.status.directoryExists", "Directory exists"),
        value: statusBadge(yesNo(s.directoryExists), s.directoryExists ? "is-good" : "is-bad")
      },
      {
        label: t("webConfig.status.mainJsExists", "Main JS exists"),
        value: statusBadge(yesNo(s.mainJsExists), s.mainJsExists ? "is-good" : "is-bad")
      },
      {
        label: t("webConfig.status.playerJsExists", "Player JS exists"),
        value: statusBadge(yesNo(s.playerJsExists), s.playerJsExists ? "is-good" : "is-bad")
      },
      {
        label: t("webConfig.status.usingEmbedded", "Using embedded assets"),
        value: statusBadge(yesNo(s.usingEmbedded), s.usingEmbedded ? "is-warn" : "is-good")
      },
      {
        label: t("webConfig.status.playerPath", "Resolved player path"),
        value: '<code>' + esc(s.playerPath || "-") + '</code>'
      }
    ];

    el.innerHTML = rows.map(function(row) {
      return '\n      <div class="nexus-status-row">\n        <div class="nexus-status-label">' + esc(row.label) + '</div>\n        <div class="nexus-status-value">' + row.value + '</div>\n      </div>\n    ';
    }).join("");
  }

  function showStatus(view) {
    return getStatus().then(function(s) {
       renderStatus(view, s);
    });
  }

  function showSnippet(view) {
    return fetch(api("Snippet"))
      .then(function(r) {
        if (!r.ok) throw new Error("Failed to get snippet: " + r.status);
        return r.text();
      })
      .then(function(html) {
        var box = view.querySelector("#snippet");
        if (!box) return;

        var parsed = new DOMParser().parseFromString(html, "text/html");
        box.innerHTML = (parsed && parsed.body && parsed.body.innerHTML) || html;
        view.__snippetLoaded = true;
      });
  }

  function getEnv() {
    return fetch(api("Env"))
      .then(function(r) {
        if (!r.ok) throw new Error("Failed to get env: " + r.status);
        return r.json();
      });
  }

  function fileState(exists, writable) {
    var parts = [
      statusBadge(
        exists ? t("webConfig.env.found", "Found") : t("webConfig.env.notFound", "Not found"),
        exists ? "is-good" : "is-bad"
      )
    ];

    if (exists) {
      parts.push(
        statusBadge(
          writable ? t("webConfig.env.writable", "Writable") : t("webConfig.env.notWritable", "Not writable"),
          writable ? "is-good" : "is-warn"
        )
      );
    }

    return parts.join("");
  }

  function renderEnv(view, env) {
    view.__envData = env;
    setText(view, "#envUser", env.user || "?");
    setText(view, "#envWebRoot", env.webRoot || "(not found)");

    var idx = view.querySelector("#envIdx");
    var gz = view.querySelector("#envGz");
    var br = view.querySelector("#envBr");
    if (idx) idx.innerHTML = fileState(env.files && env.files.indexHtml && env.files.indexHtml.exists, env.files && env.files.indexHtml && env.files.indexHtml.writable);
    if (gz) gz.innerHTML = fileState(env.files && env.files.indexGz && env.files.indexGz.exists, env.files && env.files.indexGz && env.files.indexGz.writable);
    if (br) br.innerHTML = fileState(env.files && env.files.indexBr && env.files.indexBr.exists, env.files && env.files.indexBr && env.files.indexBr.writable);

    var aclEl = view.querySelector("#envAcl");
    if (aclEl) {
      var primary = (env.acl && env.acl.primary) || t("webConfig.messages.envPending", "(not computed yet)");
      var alternative = (env.acl && env.acl.alternative)
        ? "\n\n# " + String(t("webConfig.env.alternativeAcl", "Alternative")) + ":\n" + String(env.acl.alternative)
        : "";
      aclEl.textContent = String(primary) + String(alternative);
    }
  }

  function refreshEnv(view) {
    return getEnv().then(function(env) {
       renderEnv(view, env);
       showMessage(view, t("webConfig.messages.webPathUpdated", "Web path and permissions updated."), "ok");
    });
  }

  function syncEnvCardVisibility(view) {
    if (!view) return;

    var shouldHideEnvCard = view.__inmemOk === true;
    var envCard = view.querySelector("#envCard");
    var snippetGrid = view.querySelector("#snippetGrid");

    if (envCard) {
      envCard.hidden = shouldHideEnvCard;
    }

    if (snippetGrid) {
      snippetGrid.classList.toggle("nexus-grid--single", shouldHideEnvCard);
    }
  }

  function renderPhysicalPatchFallbackToggle(view) {
    var shouldShow = (view && (!view.__inmemOk || !!view.__physicalPatchFallbackEnabled));
    if (!shouldShow) return "";

    var checked = !!(view && view.__physicalPatchFallbackEnabled);
    var disabled = !!(view && view.__physicalPatchFallbackBusy);

    return '\n      <div class="nexus-inline-toggle">\n        <label class="inputLabel inputLabel--checkbox" for="physicalPatchFallbackToggle">\n          <input id="physicalPatchFallbackToggle" type="checkbox" ' + (checked ? "checked" : "") + ' ' + (disabled ? "disabled" : "") + '>\n          <span>' + esc(t("webConfig.inMemory.fallbackToggleLabel", "Enable physical index.html patch fallback")) + '</span>\n        </label>\n        <div class="fieldDescription">' + esc(t("webConfig.inMemory.fallbackToggleHint", "Disabled by default. Enable this only if runtime injection does not work or if you explicitly need disk patching. When enabled, NexusPobreFlix will try to patch index.html during startup and configuration changes.")) + '</div>\n      </div>\n    ';
  }

  function updatePhysicalPatchFallback(view, enabled) {
    if (!view || view.__physicalPatchFallbackBusy) return Promise.resolve();

    var previous = !!view.__physicalPatchFallbackEnabled;
    view.__physicalPatchFallbackBusy = true;

    var currentToggle = view.querySelector("#physicalPatchFallbackToggle");
    if (currentToggle) currentToggle.disabled = true;

    return postConfiguration({
      enablePhysicalIndexHtmlPatchFallback: !!enabled
    })
      .then(function() {
        view.__physicalPatchFallbackEnabled = !!enabled;
        return getEnv();
      })
      .then(function(env) {
        renderEnv(view, env);
        return showStatus(view);
      })
      .then(function() {
        return checkInMemory(view);
      })
      .then(function() {
        showMessage(
          view,
          enabled
            ? t("webConfig.messages.physicalPatchFallbackEnabled", "Physical index.html patch fallback enabled.")
            : t("webConfig.messages.physicalPatchFallbackDisabled", "Physical index.html patch fallback disabled."),
          "ok"
        );
      })
      .catch(function(error) {
        view.__physicalPatchFallbackEnabled = previous;
        showMessage(view, (error && error.message) || String(error), "err");
      })
      .finally(function() {
        view.__physicalPatchFallbackBusy = false;
        if (view.__inmemOk !== true) {
          renderInMem(view, false);
        } else if (view.__physicalPatchFallbackEnabled) {
          renderInMem(view, true);
        }
      });
  }

  function renderInMem(view, ok) {
    view.__inmemOk = !!ok;
    syncEnvCardVisibility(view);

    var el = view.querySelector("#inmem");
    if (!el) return;

    if (ok) {
      el.className = "nexus-inline-state ok";
      el.innerHTML = '\n        <strong>' + esc(t("webConfig.inMemory.activeTitle", "In-memory injection is active.")) + '</strong><br>\n        <span>' + esc(t("webConfig.inMemory.activeHint", "Physical patching is not required while runtime injection is working.")) + '</span>\n        ' + renderPhysicalPatchFallbackToggle(view) + '\n      ';
    } else {
      el.className = "nexus-inline-state warn";
      el.innerHTML = '\n        <strong>' + esc(t("webConfig.inMemory.inactiveTitle", "In-memory injection was not detected.")) + '</strong><br>\n        <span>' + esc(t("webConfig.inMemory.inactiveHint", "Use Patch if you want to persist the snippet into index.html.")) + '</span>\n        ' + renderPhysicalPatchFallbackToggle(view) + '\n      ';
    }

    var toggle = el.querySelector("#physicalPatchFallbackToggle");
    if (toggle) {
      toggle.addEventListener("change", function(event) {
        var nextValue = !!(event && event.currentTarget && event.currentTarget.checked);
        updatePhysicalPatchFallback(view, nextValue).catch(function(error) {
          showMessage(view, (error && error.message) || String(error), "err");
        });
      });
    }
  }

  function checkInMemory(view) {
    var url = String(jfRoot) + "/web/?_nexus_check=" + String(Date.now());
    return fetch(url, { cache: "no-store", headers: { "X-Nexus-Check": "1" } })
      .then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function(txt) {
        var ok = /<!--\s*NEXUS-INJECT BEGIN\s*-->/.test(txt);
        renderInMem(view, ok);
        return ok;
      })
      .catch(function() {
        renderInMem(view, false);
        return false;
      });
  }

  function doPatch(view, kind) {
    var ep = kind === "patch" ? "Patch" : "Unpatch";
    return fetch(api(ep), { method: "POST" })
      .then(function(r) {
        if (!r.ok) throw new Error(ep + " failed: " + r.status);

        showMessage(
          view,
          kind === "patch"
            ? t("webConfig.messages.patchDone", "Patch completed.")
            : t("webConfig.messages.unpatchDone", "Patch removed."),
          "ok"
        );

        return checkInMemory(view);
      })
      .then(function() {
        return showStatus(view);
      });
  }

  function authHeaders() {
    try {
      const apiClient = window.ApiClient;
      const token = (apiClient && typeof apiClient.accessToken === "function")
        ? apiClient.accessToken()
        : (apiClient ? (apiClient._accessToken || apiClient._authToken) : null);
      if (token) return { "X-Emby-Token": token };
    } catch (e) {}
    return {};
  }

  function initView(view) {
    if (view.__nexus_initialized) return;
    view.__nexus_initialized = true;

    loadLanguagePack().then(function() {
      applyTranslations(view);
      initTabs(view);

      var saveBtn = view.querySelector("#saveBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function() {
          saveConfig(view).then(function() {
            showMessage(view, t("webConfig.messages.settingsSaved", "Settings saved."), "ok");
            return Promise.all([showStatus(view), showSnippet(view), refreshEnv(view)]);
          })
          .then(function() {
            return checkInMemory(view);
          })
          .catch(function(e) {
            console.error(e);
            showMessage(view, (e && e.message) || String(e), "err");
          });
        });
      }

      var pubBtn = view.querySelector("#publishGlobalBtn");
      if (pubBtn) {
        pubBtn.addEventListener("click", function() {
          var snapshot = {};
          try {
            for (var i = 0; i < localStorage.length; i++) {
              var key = localStorage.key(i);
              snapshot[key] = localStorage.getItem(key);
            }
          } catch (e) {}

          var headers = authHeaders();
          headers["Content-Type"] = "application/json";

          fetch(api("UserSettings/Publish"), {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ global: snapshot })
          })
          .then(function(r) {
            if (!r.ok) throw new Error("Publish failed");
            return fetch(String(jfRoot) + "/Plugins/NexusPobreFlix/UserSettings", { cache: "no-store" });
          })
          .then(function() {
            showMessage(view, t("webConfig.messages.publishDone", "Global settings published successfully."), "ok");
          })
          .catch(function(e) {
            showMessage(view, (e && e.message) || String(e), "err");
          });
        });
      }

      var relBtn = view.querySelector("#reloadNexusPobreFlixSettingsBtn");
      if (relBtn) {
        relBtn.addEventListener("click", function() {
          ensureNexusPobreFlixSettings(view, { force: true }).catch(function(e) {
            showMessage(view, (e && e.message) || String(e), "err");
          });
        });
      }

      var refrBtn = view.querySelector("#refreshEnvBtn");
      if (refrBtn) {
        refrBtn.addEventListener("click", function() {
          refreshEnv(view).catch(function(e) {
            showMessage(view, (e && e.message) || String(e), "err");
          });
        });
      }

      var cpBtn = view.querySelector("#copyAclBtn");
      if (cpBtn) {
        cpBtn.addEventListener("click", function() {
          var box = view.querySelector("#envAcl");
          var toCopy = (box && box.textContent) || "";
          if (!toCopy.trim()) {
            showMessage(view, t("webConfig.messages.nothingToCopy", "There is nothing to copy."), "warn");
            return;
          }

          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(toCopy)
              .then(function() { showMessage(view, t("webConfig.messages.commandsCopied", "Permission commands copied."), "ok"); })
              .catch(function(err) { showMessage(view, "Copy failed: " + err, "err"); });
          } else {
             showMessage(view, "Clipboard API not available", "err");
          }
        });
      }

      var pBtn = view.querySelector("#patchBtn");
      if (pBtn) {
        pBtn.addEventListener("click", function() {
          doPatch(view, "patch").catch(function(e) {
            showMessage(view, (e && e.message) || String(e), "err");
          });
        });
      }

      var uBtn = view.querySelector("#unpatchBtn");
      if (uBtn) {
        uBtn.addEventListener("click", function() {
          doPatch(view, "unpatch").catch(function(e) {
            showMessage(view, (e && e.message) || String(e), "err");
          });
        });
      }

      loadConfig(view)
        .then(function() {
          return Promise.all([showStatus(view), showSnippet(view), refreshEnv(view)]);
        })
        .then(function() {
          return checkInMemory(view);
        })
        .catch(function(e) {
          console.error(e);
        });
    });
  }

  function refreshLanguageIfNeeded() {
    var view = document.getElementById("NexusPobreFlixConfigPage");
    if (!view) return Promise.resolve();
    return loadLanguagePack().then(function() {
      applyTranslations(view);
    });
  }

  function handlePageEvents(e) {
    var view = (e.detail && e.detail.view) || e.target || null;
    var pageId = "NexusPobreFlixConfigPage";
    var legacyId = "NexusPobreFlixConfigPage";
    if (view && (view.id === pageId || view.id === legacyId || (view.querySelector && (view.querySelector("#" + pageId) || view.querySelector("#" + legacyId))))) {
      var page = (view.id === pageId || view.id === legacyId) ? view : (view.querySelector("#" + pageId) || view.querySelector("#" + legacyId));
      if (page) setTimeout(function() { initView(page); }, 50);
    }
  }

  window.addEventListener("storage", function(e) {
    if (e.key === "defaultLanguage") {
      refreshLanguageIfNeeded().catch(function() {});
    }
  });

  document.addEventListener("viewshow", handlePageEvents);
  document.addEventListener("pageshow", handlePageEvents);
  document.addEventListener("DOMContentLoaded", function () {
    var existingView = document.getElementById("NexusPobreFlixConfigPage");
    if (existingView) setTimeout(function() { initView(existingView); }, 50);
  });

  window.addEventListener("NexusPobreFlix:plugin-config-open-request", function(event) {
    var detail = (event && event.detail) || {};
    if (detail.pluginTab === "NexusPobreFlix-settings") {
      try {
        localStorage.setItem(TAB_STORAGE_KEY, "NexusPobreFlix-settings");
      } catch (e) {}
      try {
        sessionStorage.setItem(NEXUS_SUBTAB_STORAGE_KEY, String(detail.settingsTab || "NexusPobreFlix"));
      } catch (e) {}
    }

    var existingView = document.getElementById("NexusPobreFlixConfigPage");
    if (existingView) {
      activateTab(existingView, detail.pluginTab || "NexusPobreFlix");
    }
  });

  var immediateCheck = document.getElementById("NexusPobreFlixConfigPage");
  if (immediateCheck) setTimeout(function() { initView(immediateCheck); }, 50);
})();
