(function () {
  function getJfRootFromLocation() {
    try {
      const baseHref = document.querySelector("base[href]")?.getAttribute("href");
      if (baseHref) {
        const url = new URL(baseHref, window.location.href);
        return String(url.pathname || "")
          .replace(/\/web\/?$/i, "")
          .replace(/\/+$/, "");
      }
    } catch {}

    const path = String(window.location.pathname || "/");
    const match = path.match(/^(.*?)(?:\/web(?:\/|$).*)$/i);
    return match?.[1] ? match[1].replace(/\/+$/, "") : "";
  }

  const jfRoot = getJfRootFromLocation();
  const langModuleUrl = `${window.location.origin}${jfRoot}/slider/language/index.js`;
  const webSettingsModuleUrl = `${window.location.origin}${jfRoot}/Plugins/NexusPobreFlix/assets/settings.js`;
  const sliderSettingsCssUrl = `${window.location.origin}${jfRoot}/slider/src/settings.css`;
  const TAB_STORAGE_KEY = "NexusPobreFlix-config-active-tab";
  const NEXUS_SUBTAB_STORAGE_KEY = "NexusPobreFlix-requested-subtab";

  const api = (p) => `${jfRoot}/Plugins/NexusPobreFlix/${p}`;
  const esc = (s) => (s ?? "").toString().replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

  const fallbackLabels = {
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

  const state = {
    labels: fallbackLabels,
    lang: "eng"
  };

  function getByPath(obj, pathExpr) {
    return String(pathExpr || "")
      .split(".")
      .reduce((acc, key) => (acc && acc[key] != null ? acc[key] : null), obj);
  }

  function t(pathExpr, fallback = "") {
    const value = getByPath(state.labels, pathExpr);
    return value == null ? fallback : value;
  }

  function setText(view, selector, text) {
    const el = view.querySelector(selector);
    if (el) el.textContent = text;
  }

  function setHtml(view, selector, html) {
    const el = view.querySelector(selector);
    if (el) el.innerHTML = html;
  }

  function setPlaceholder(view, selector, text) {
    const el = view.querySelector(selector);
    if (el) el.setAttribute("placeholder", text);
  }

  function ensureStylesheet(key, href) {
    let link = document.querySelector(`link[data-nexus-config-css="${key}"]`);
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
    const map = {
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
    return `${jfRoot || ""}/web` || "/web";
  }

  async function loadLanguagePack() {
    try {
      const mod = await import(langModuleUrl);
      const lang = typeof mod.getEffectiveLanguage === "function"
        ? mod.getEffectiveLanguage()
        : (typeof mod.detectBrowserLanguage === "function" ? mod.detectBrowserLanguage() : "eng");
      const labels = typeof mod.getLanguageLabels === "function"
        ? mod.getLanguageLabels(lang)
        : null;

      if (labels) {
        state.labels = labels;
        state.lang = lang || "eng";
        return;
      }
    } catch {}

    state.labels = fallbackLabels;
    state.lang = "eng";
  }

  function showMessage(view, text, kind = "") {
    const el = view.querySelector("#msg");
    if (!el) return;
    el.className = `fieldDescription ${kind}`.trim();
    el.textContent = text;
    clearTimeout(el.__t);
    el.__t = setTimeout(() => {
      el.textContent = "";
      el.className = "fieldDescription";
    }, 3200);
  }

  function renderNexusPobreFlixSettingsPlaceholder(view, text, tone = "") {
    const host = view.querySelector("#NexusPobreFlixSettingsHost");
    if (!host) return;

    const placeholder = document.createElement("div");
    placeholder.id = "NexusPobreFlixSettingsPlaceholder";
    placeholder.className = `nexus-empty ${tone ? `nexus-empty--${tone}` : ""}`.trim();
    placeholder.textContent = text;
    host.replaceChildren(placeholder);
  }

  function consumeRequestedNexusPobreFlixSettingsTab() {
    let value = "";
    try {
      value = sessionStorage.getItem(NEXUS_SUBTAB_STORAGE_KEY) || "";
      if (value) sessionStorage.removeItem(NEXUS_SUBTAB_STORAGE_KEY);
    } catch {}
    return String(value || "").trim() || "NexusPobreFlix";
  }

  async function ensureNexusPobreFlixSettings(view, { force = false } = {}) {
    const host = view.querySelector("#NexusPobreFlixSettingsHost");
    const reloadBtn = view.querySelector("#reloadNexusPobreFlixSettingsBtn");
    if (!host) return null;

    const requestedInnerTab = consumeRequestedNexusPobreFlixSettingsTab();

    if (!force && host.__nexusReady && host.querySelector("#settings-modal")) {
      const existingApi = host.__nexusApi || host.__nexusSettingsApi || null;
      existingApi?.open?.(requestedInnerTab);
      return host.querySelector("#settings-modal");
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

    host.__nexusPromise = (async () => {
      ensureStylesheet("NexusPobreFlix-settings", sliderSettingsCssUrl);

      const settingsModule = await import(webSettingsModuleUrl);
      const settingsApi = typeof settingsModule?.mountNexusPobreFlixSettingsPage === "function"
        ? await settingsModule.mountNexusPobreFlixSettingsPage(host, {
            defaultTab: requestedInnerTab,
            force
          })
        : null;
      const modal = settingsApi?.element || host.querySelector("#settings-modal");

      if (!modal || !settingsApi) {
        throw new Error("Nexus PobreFlix settings page is not available.");
      }

      host.__nexusApi = settingsApi;
      host.__nexusReady = true;
      view.__NexusPobreFlixSettingsLoaded = true;
      return modal;
    })()
      .catch((error) => {
        const fallback = t("webConfig.messages.NexusPobreFlixSettingsLoadFailed", "Nexus PobreFlix settings could not be loaded.");
        const detail = String(error?.message || "").trim();
        renderNexusPobreFlixSettingsPlaceholder(view, detail ? `${fallback} ${detail}` : fallback, "error");
        throw error;
      })
      .finally(() => {
        host.__nexusPromise = null;
        if (reloadBtn) reloadBtn.disabled = false;
      });

    return host.__nexusPromise;
  }

  function activateTab(view, tabName) {
    view.querySelectorAll(".nexus-tab").forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });

    view.querySelectorAll(".nexus-panel").forEach((panel) => {
      const active = panel.dataset.panel === tabName;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });

    try {
      localStorage.setItem(TAB_STORAGE_KEY, tabName);
    } catch {}

    if (tabName === "NexusPobreFlix-settings") {
      ensureNexusPobreFlixSettings(view).catch((error) => {
        console.error("Nexus PobreFlix settings load failed:", error);
      });
    }
  }

  function initTabs(view) {
    if (view.__nexus_tabs_bound) return;
    view.__nexus_tabs_bound = true;

    view.querySelectorAll(".nexus-tab").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(view, tab.dataset.tab || "NexusPobreFlix"));
    });

    let active = "NexusPobreFlix";
    try {
      const stored = localStorage.getItem(TAB_STORAGE_KEY);
      if (stored && ["NexusPobreFlix", "NexusPobreFlix-settings", "status", "snippet"].includes(stored)) {
        active = stored;
      }
    } catch {}
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

  async function loadConfig(view) {
    const r = await fetch(api("Configuration"));
    if (!r.ok) throw new Error("Failed to load config: " + r.status);
    const cfg = await r.json();
    view.__physicalPatchFallbackEnabled = !!cfg.enablePhysicalIndexHtmlPatchFallback;
    view.querySelector("#scriptDir").value = cfg.scriptDirectory || "";
    view.querySelector("#playerSub").value = cfg.playerSubdir || "modules/player";
    const fg = view.querySelector("#forceGlobal");
    if (fg) fg.checked = !!cfg.forceGlobalUserSettings;
    return cfg;
  }

  async function postConfiguration(body) {
    const r = await fetch(api("Configuration"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    });

    if (!r.ok) throw new Error("Save failed: " + r.status + " - " + await r.text());
  }

  async function saveConfig(view) {
    const body = {
      scriptDirectory: view.querySelector("#scriptDir").value.trim(),
      playerSubdir: view.querySelector("#playerSub").value.trim(),
      forceGlobalUserSettings: !!view.querySelector("#forceGlobal")?.checked
    };

    await postConfiguration(body);
  }

  async function getStatus() {
    const r = await fetch(api("Status"));
    if (!r.ok) throw new Error("Failed to get status: " + r.status);
    return await r.json();
  }

  function statusBadge(text, tone = "is-good") {
    return `<span class="nexus-badge ${tone}">${esc(text)}</span>`;
  }

  function yesNo(value) {
    return value
      ? t("webConfig.status.yes", "Yes")
      : t("webConfig.status.no", "No");
  }

  function renderStatus(view, s) {
    view.__statusData = s;
    const el = view.querySelector("#status");
    if (!el) return;

    const rows = [
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
        value: `<code>${esc(s.playerPath || "-")}</code>`
      }
    ];

    el.innerHTML = rows.map((row) => `
      <div class="nexus-status-row">
        <div class="nexus-status-label">${esc(row.label)}</div>
        <div class="nexus-status-value">${row.value}</div>
      </div>
    `).join("");
  }

  async function showStatus(view) {
    renderStatus(view, await getStatus());
  }

  async function showSnippet(view) {
    const r = await fetch(api("Snippet"));
    if (!r.ok) throw new Error("Failed to get snippet: " + r.status);
    const html = await r.text();
    const box = view.querySelector("#snippet");
    if (!box) return;

    const parsed = new DOMParser().parseFromString(html, "text/html");
    box.innerHTML = parsed?.body?.innerHTML || html;
    view.__snippetLoaded = true;
  }

  async function getEnv() {
    const r = await fetch(api("Env"));
    if (!r.ok) throw new Error("Failed to get env: " + r.status);
    return await r.json();
  }

  function fileState(exists, writable) {
    const parts = [
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

    const idx = view.querySelector("#envIdx");
    const gz = view.querySelector("#envGz");
    const br = view.querySelector("#envBr");
    if (idx) idx.innerHTML = fileState(env.files?.indexHtml?.exists, env.files?.indexHtml?.writable);
    if (gz) gz.innerHTML = fileState(env.files?.indexGz?.exists, env.files?.indexGz?.writable);
    if (br) br.innerHTML = fileState(env.files?.indexBr?.exists, env.files?.indexBr?.writable);

    const aclEl = view.querySelector("#envAcl");
    if (aclEl) {
      const primary = env.acl?.primary || t("webConfig.messages.envPending", "(not computed yet)");
      const alternative = env.acl?.alternative
        ? `\n\n# ${t("webConfig.env.alternativeAcl", "Alternative")}:\n${env.acl.alternative}`
        : "";
      aclEl.textContent = `${primary}${alternative}`;
    }
  }

  async function refreshEnv(view) {
    renderEnv(view, await getEnv());
    showMessage(view, t("webConfig.messages.webPathUpdated", "Web path and permissions updated."), "ok");
  }

  function syncEnvCardVisibility(view) {
    if (!view) return;

    const shouldHideEnvCard = view.__inmemOk === true;
    const envCard = view.querySelector("#envCard");
    const snippetGrid = view.querySelector("#snippetGrid");

    if (envCard) {
      envCard.hidden = shouldHideEnvCard;
    }

    if (snippetGrid) {
      snippetGrid.classList.toggle("nexus-grid--single", shouldHideEnvCard);
    }
  }

  function renderPhysicalPatchFallbackToggle(view) {
    const shouldShow = !view?.__inmemOk || !!view?.__physicalPatchFallbackEnabled;
    if (!shouldShow) return "";

    const checked = !!view?.__physicalPatchFallbackEnabled;
    const disabled = !!view?.__physicalPatchFallbackBusy;

    return `
      <div class="nexus-inline-toggle">
        <label class="inputLabel inputLabel--checkbox" for="physicalPatchFallbackToggle">
          <input id="physicalPatchFallbackToggle" type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span>${esc(t("webConfig.inMemory.fallbackToggleLabel", "Enable physical index.html patch fallback"))}</span>
        </label>
        <div class="fieldDescription">${esc(t("webConfig.inMemory.fallbackToggleHint", "Disabled by default. Enable this only if runtime injection does not work or if you explicitly need disk patching. When enabled, NexusPobreFlix will try to patch index.html during startup and configuration changes."))}</div>
      </div>
    `;
  }

  async function updatePhysicalPatchFallback(view, enabled) {
    if (!view || view.__physicalPatchFallbackBusy) return;

    const previous = !!view.__physicalPatchFallbackEnabled;
    view.__physicalPatchFallbackBusy = true;

    const currentToggle = view.querySelector("#physicalPatchFallbackToggle");
    if (currentToggle) currentToggle.disabled = true;

    try {
      await postConfiguration({
        enablePhysicalIndexHtmlPatchFallback: !!enabled
      });

      view.__physicalPatchFallbackEnabled = !!enabled;
      renderEnv(view, await getEnv());
      await showStatus(view);
      await checkInMemory(view);

      showMessage(
        view,
        enabled
          ? t("webConfig.messages.physicalPatchFallbackEnabled", "Physical index.html patch fallback enabled.")
          : t("webConfig.messages.physicalPatchFallbackDisabled", "Physical index.html patch fallback disabled."),
        "ok"
      );
    } catch (error) {
      view.__physicalPatchFallbackEnabled = previous;
      showMessage(view, error?.message || String(error), "err");
    } finally {
      view.__physicalPatchFallbackBusy = false;
      if (view.__inmemOk !== true) {
        renderInMem(view, false);
      } else if (view.__physicalPatchFallbackEnabled) {
        renderInMem(view, true);
      }
    }
  }

  function renderInMem(view, ok) {
    view.__inmemOk = !!ok;
    syncEnvCardVisibility(view);

    const el = view.querySelector("#inmem");
    if (!el) return;

    if (ok) {
      el.className = "nexus-inline-state ok";
      el.innerHTML = `
        <strong>${esc(t("webConfig.inMemory.activeTitle", "In-memory injection is active."))}</strong><br>
        <span>${esc(t("webConfig.inMemory.activeHint", "Physical patching is not required while runtime injection is working."))}</span>
        ${renderPhysicalPatchFallbackToggle(view)}
      `;
    } else {
      el.className = "nexus-inline-state warn";
      el.innerHTML = `
        <strong>${esc(t("webConfig.inMemory.inactiveTitle", "In-memory injection was not detected."))}</strong><br>
        <span>${esc(t("webConfig.inMemory.inactiveHint", "Use Patch if you want to persist the snippet into index.html."))}</span>
        ${renderPhysicalPatchFallbackToggle(view)}
      `;
    }

    const toggle = el.querySelector("#physicalPatchFallbackToggle");
    if (toggle) {
      toggle.addEventListener("change", (event) => {
        const nextValue = !!event?.currentTarget?.checked;
        updatePhysicalPatchFallback(view, nextValue).catch((error) => {
          showMessage(view, error?.message || String(error), "err");
        });
      });
    }
  }

  async function checkInMemory(view) {
    try {
      const url = `${jfRoot}/web/?_nexus_check=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store", headers: { "X-Nexus-Check": "1" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const txt = await r.text();
      const ok = /<!--\s*NEXUS-INJECT BEGIN\s*-->/.test(txt);
      renderInMem(view, ok);
      return ok;
    } catch {
      renderInMem(view, false);
      return false;
    }
  }

  async function doPatch(view, kind) {
    const ep = kind === "patch" ? "Patch" : "Unpatch";
    const r = await fetch(api(ep), { method: "POST" });
    if (!r.ok) throw new Error(`${ep} failed: ` + r.status);

    showMessage(
      view,
      kind === "patch"
        ? t("webConfig.messages.patchDone", "Patch completed.")
        : t("webConfig.messages.unpatchDone", "Patch removed."),
      "ok"
    );

    await checkInMemory(view);
    await showStatus(view);
  }

  function authHeaders() {
    try {
      const token =
        window.ApiClient?.accessToken?.() ||
        window.ApiClient?._accessToken ||
        window.ApiClient?._authToken;
      if (token) return { "X-Emby-Token": token };
    } catch {}
    return {};
  }

  async function initView(view) {
    if (view.__nexus_initialized) return;
    view.__nexus_initialized = true;

    await loadLanguagePack();
    applyTranslations(view);
    initTabs(view);

    view.querySelector("#saveBtn")?.addEventListener("click", async () => {
      try {
        await saveConfig(view);
        showMessage(view, t("webConfig.messages.settingsSaved", "Settings saved."), "ok");
        await Promise.all([showStatus(view), showSnippet(view), refreshEnv(view)]);
        await checkInMemory(view);
      } catch (e) {
        console.error(e);
        showMessage(view, e.message || String(e), "err");
      }
    });

    view.querySelector("#publishGlobalBtn")?.addEventListener("click", async () => {
      try {
        const snapshot = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          snapshot[key] = localStorage.getItem(key);
        }

        const r = await fetch(api("UserSettings/Publish"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ global: snapshot })
        });

        if (!r.ok) throw new Error("Publish failed");
        await fetch(`${jfRoot}/Plugins/NexusPobreFlix/UserSettings`, { cache: "no-store" }).catch(() => null);
        showMessage(view, t("webConfig.messages.publishDone", "Global settings published successfully."), "ok");
      } catch (e) {
        showMessage(view, e.message || String(e), "err");
      }
    });

    view.querySelector("#reloadNexusPobreFlixSettingsBtn")?.addEventListener("click", async () => {
      try {
        await ensureNexusPobreFlixSettings(view, { force: true });
      } catch (e) {
        showMessage(view, e.message || String(e), "err");
      }
    });

    view.querySelector("#refreshEnvBtn")?.addEventListener("click", async () => {
      try {
        await refreshEnv(view);
      } catch (e) {
        showMessage(view, e.message || String(e), "err");
      }
    });

    view.querySelector("#copyAclBtn")?.addEventListener("click", () => {
      const box = view.querySelector("#envAcl");
      const toCopy = box?.textContent || "";
      if (!toCopy.trim()) {
        showMessage(view, t("webConfig.messages.nothingToCopy", "There is nothing to copy."), "warn");
        return;
      }

      navigator.clipboard.writeText(toCopy)
        .then(() => showMessage(view, t("webConfig.messages.commandsCopied", "Permission commands copied."), "ok"))
        .catch((err) => showMessage(view, "Copy failed: " + err, "err"));
    });

    view.querySelector("#patchBtn")?.addEventListener("click", async () => {
      try {
        await doPatch(view, "patch");
      } catch (e) {
        showMessage(view, e.message || String(e), "err");
      }
    });

    view.querySelector("#unpatchBtn")?.addEventListener("click", async () => {
      try {
        await doPatch(view, "unpatch");
      } catch (e) {
        showMessage(view, e.message || String(e), "err");
      }
    });

    try {
      await loadConfig(view);
    } catch (e) {
      showMessage(view, `${t("webConfig.messages.configLoadFailed", "Configuration could not be loaded.")} ${e.message || String(e)}`, "err");
    }

    try {
      await Promise.all([showStatus(view), showSnippet(view), refreshEnv(view)]);
      await checkInMemory(view);
    } catch (e) {
      console.error(e);
    }
  }

  async function refreshLanguageIfNeeded() {
    const view = document.getElementById("NexusPobreFlixConfigPage");
    if (!view) return;
    await loadLanguagePack();
    applyTranslations(view);
  }

  function handlePageEvents(e) {
    const view = e.detail?.view || e.target || null;
    const pageId = "NexusPobreFlixConfigPage";
    const legacyId = "NexusPobreFlixConfigPage";
    if (view && (view.id === pageId || view.id === legacyId || (view.querySelector && (view.querySelector(`#${pageId}`) || view.querySelector(`#${legacyId}`))))) {
      const page = (view.id === pageId || view.id === legacyId) ? view : (view.querySelector(`#${pageId}`) || view.querySelector(`#${legacyId}`));
      if (page) setTimeout(() => initView(page), 50);
    }
  }

  window.addEventListener("storage", (e) => {
    if (e.key === "defaultLanguage") {
      refreshLanguageIfNeeded().catch(() => {});
    }
  });

  document.addEventListener("viewshow", handlePageEvents);
  document.addEventListener("pageshow", handlePageEvents);
  document.addEventListener("DOMContentLoaded", function () {
    const existingView = document.getElementById("NexusPobreFlixConfigPage");
    if (existingView) setTimeout(() => initView(existingView), 50);
  });

  window.addEventListener("NexusPobreFlix:plugin-config-open-request", (event) => {
    const detail = event?.detail || {};
    if (detail.pluginTab === "Nexus PobreFlix-settings") {
      try {
        localStorage.setItem(TAB_STORAGE_KEY, "Nexus PobreFlix-settings");
      } catch {}
      try {
        sessionStorage.setItem(NEXUS_SUBTAB_STORAGE_KEY, String(detail.settingsTab || "NexusPobreFlix"));
      } catch {}
    }

    const existingView = document.getElementById("NexusPobreFlixConfigPage");
    if (existingView) {
      activateTab(existingView, detail.pluginTab || "NexusPobreFlix");
    }
  });

  const immediateCheck = document.getElementById("NexusPobreFlixConfigPage");
  if (immediateCheck) setTimeout(() => initView(immediateCheck), 50);
})();
