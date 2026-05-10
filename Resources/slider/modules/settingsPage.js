import { getConfig, publishAdminSnapshotIfForced, getAdminTargetProfile, getDeviceProfileAuto, getSettingsHotkey, normalizeSettingsHotkey, SETTINGS_HOTKEY_DEFAULT } from "./config.js";
import { isLocalStorageAvailable, updateConfig } from "./configPersistence.js";
import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';
import { loadCSS } from "./playerStyles.js";
import { showNotification } from "./player/ui/notification.js";
import { createPositionEditor } from './settings/positionPage.js';
import { updateSlidePosition } from './positionUtils.js';
import { createBackupRestoreButtons } from './configExporter.js';
import { applyRawConfig, applySettings } from './settings/applySettings.js';
import { createSliderPanel } from './settings/sliderPage.js';
import { createAnimationPanel } from './settings/animationsPage.js';
import { createMusicPanel } from './settings/musicPage.js';
import { createStatusRatingPanel, createActorPanel, createDirectorPanel, createInfoPanel, createLogoTitlePanel, createAboutPanel, createProviderPanel, createDescriptionPanel } from './settings/otherPage.js';
import { createQueryPanel } from './settings/apiPage.js';
import { createPausePanel } from './settings/pausePage.js';
import { createButtonsPanel } from './settings/buttonsPage.js';
import { createAvatarPanel } from './settings/avatarPage.js';
import { createNotificationsPanel } from './settings/notificationsPage.js';
import { createStudioHubsPanel } from './settings/studioHubsPage.js';
import { createHoverTrailerPanel } from './settings/hoverTrailerPage.js';
import { createTrailersPanel } from './settings/trailersPage.js';
import { createProfileChooserPanel } from './settings/profileChooserPage.js';
import { createWatchlistPanel } from './settings/watchlistPage.js';
import { createParentalPinPanel } from './settings/parentalPinPage.js';
import { createDbManagementPanel } from './settings/dbManagementPage.js';
import { createDetailsModalPanel } from './settings/detailsModalPage.js';
import { enhanceFormAccessibility } from './accessibility.js';

export { isLocalStorageAvailable, updateConfig };

var settingsModal = null;
var SETTINGS_OVERLAY_CLASS = 'jms-settings-overlay-shell';
var SETTINGS_EMBEDDED_CLASS = 'jms-settings-page-shell';

export function createSettingsModal() {
    if (settingsModal && settingsModal.isConnected) {
        return settingsModal;
    }

    var existing = document.getElementById('settings-modal');
    if (existing) {
        settingsModal = existing;
        return existing;
    }

    if (settingsModal) {
        return settingsModal;
    }

    var config = getConfig();
    var currentLang = config.defaultLanguage || getDefaultLanguage();
    var labels = getLanguageLabels(currentLang) || {};
    var monwuiTabLabel = labels.sliderSettings || 'Configurações Nexus';
    var sliderTabLabel = labels.sliderPageLabel || 'Configurações do Slider';

    var modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'settings-modal ' + String(SETTINGS_EMBEDDED_CLASS);
    modal.setAttribute('data-jms-settings-page', 'true');

    var modalContent = document.createElement('div');
    modalContent.className = 'settings-modal-content';

    var title = document.createElement('h2');
    title.textContent = monwuiTabLabel;

    function createProfileSelector(labels) {
      var wrap = document.createElement("div");
      wrap.className = "setting-item";
      wrap.style.marginBottom = "10px";

      var lab = document.createElement("label");
      lab.textContent = (labels && labels.profileTarget) ? labels.profileTarget : "Perfil de Destino";
      lab.style.marginRight = "10px";
      lab.htmlFor = "jmsProfileTarget";

      var select = document.createElement("select");
      select.id = "jmsProfileTarget";
      select.name = "jmsProfileTarget";

      var autoProfile = getDeviceProfileAuto();
      var profileNameMap = {
        desktop: (labels && labels.profileDesktop) ? labels.profileDesktop : "Perfil Desktop",
        mobile: (labels && labels.profileMobile) ? labels.profileMobile : "Perfil Mobile"
      };

      var autoProfileLabel =
        profileNameMap[autoProfile] || ((labels && labels.profileAutoUnknown) ? labels.profileAutoUnknown : autoProfile);

      var opts = [
        {
          v: "auto",
          t: String((labels && labels.profileAuto) ? labels.profileAuto : "Seleção Automática") + " (" + String(autoProfileLabel) + ")"
        },
        { v: "desktop", t: (labels && labels.profileDesktop) ? labels.profileDesktop : "Perfil Desktop" },
        { v: "mobile", t: (labels && labels.profileMobile) ? labels.profileMobile : "Perfil Mobile" }
      ];

      opts.forEach(function(o) {
        var opt = document.createElement("option");
        opt.value = o.v;
        opt.textContent = o.t;
        select.appendChild(opt);
      });

      select.value = localStorage.getItem("jms:settingsTargetProfile") || "auto";

      select.addEventListenerfunction() {
        localStorage.setItem("jms:settingsTargetProfile", select.value);
        showNotification(
          '<i class="fas fa-layer-group" style="margin-right:8px;"></i> ' + String((labels && labels.profileChanged) ? labels.profileChanged : "Perfil selecionado. Ao salvar, as configurações serão publicadas neste perfil."),
          2500,
          "info"
        );
      });

      wrap.append(lab, select);
      return wrap;
    }

    if (config && config.currentUserIsAdmin) {
      try {
        var profSel = createProfileSelector(labels);
        modalContent.appendChild(profSel);
      } catch {}
    }

    if (config && config.currentUserIsAdmin && config.forceGlobalUserSettings) {
      var forcedHint = document.createElement('div');
      forcedHint.className = 'description-text2';
      forcedHint.style.margin = '0 0 12px';
      forcedHint.textContent =
        (labels && labels.forceGlobalAdminHint) ? labels.forceGlobalAdminHint :
        'Forçar Configurações Globais está ativo. Salvar/Aplicar publica o perfil de configurações selecionado globalmente para todos os usuários.';
      modalContent.appendChild(forcedHint);
    }

    var tabContainer = document.createElement('div');
    tabContainer.className = 'settings-tabs';

    var tabContent = document.createElement('div');
    tabContent.className = 'settings-tab-content';

    var mainTab = createTab('monwui', 'fa-sliders', monwuiTabLabel, true);
    var sliderTab = createTab('slider', 'fa-gear', sliderTabLabel, false);
    var queryTab = createTab('query', 'fa-code', labels.queryStringInput || 'Configurações de Consulta API');
    var musicTab = createTab('music', 'fa-music', labels.gmmpSettings || 'Configurações GMMP');
    var studioTab = createTab('studio', 'fa-building', labels.studioHubsSettings || 'Configurações de Coleções de Estúdios');
    var profileChooserTab = createTab('profile-chooser', 'fa-user-group', labels.profileChooserHeader || 'Configurações de Quem Está Assistindo');
    var pauseTab = createTab('pause', 'fa-pause', labels.pauseSettings || 'Configurações da Tela de Pausa');
    var watchlistSettingsTab = createTab('watchlist-settings', 'fa-bookmark', labels.watchlistSettingsTab || 'Configurações da Lista de Desejos');
    var hoverTab = createTab('hover', 'fa-play-circle', labels.hoverTrailer || 'Configurações HoverTrailer');
    var trailersTab = createTab('trailers', 'fa-video', labels.trailersHeader || 'Download de Trailers / NFO');
    var notificationsTab = createTab('notifications', 'fa-bell', labels.notificationsSettings || 'Configurações de Notificação');
    var detailsModalTab = createTab('details-modal', 'fa-circle-info', labels.detailsModalSettingsTab || 'Configurações do Módulo de Detalhes');
    var avatarTab = createTab('avatar', 'fa-user', labels.avatarCreateInput || 'Configurações de Avatar');
    var parentalPinTab = (config && config.currentUserIsAdmin)
      ? createTab('parental-pin', 'fa-key', labels.parentalPinTab || 'Configurações de PIN Parental')
      : null;
    var positionTab = createTab('position', 'fa-arrows-up-down-left-right', labels.positionSettings || 'Configurações de Posicionamento');
    var dbManagementTab = createTab('db-management', 'fa-database', labels.dbManagementTab || 'Gerenciamento de DB');
    var exporterTab = createTab('exporter', 'fa-download', labels.backupRestore || 'Backup e Restauração');
    var aboutTab = createTab('about', 'fa-circle-info', labels.aboutHeader || 'Sobre');

    var tabs = [
        mainTab, sliderTab, queryTab, musicTab, studioTab, profileChooserTab,
        pauseTab, watchlistSettingsTab, hoverTab, trailersTab, notificationsTab, detailsModalTab,
        avatarTab, parentalPinTab, positionTab, dbManagementTab, exporterTab, aboutTab
    ].filter(Boolean);
    tabContainer.append(...tabs);

    var sliderPanel = createSliderPanel(config, labels);
    var animationPanel = createAnimationPanel(config, labels);
    var profileChooserPanel = createProfileChooserPanel(config, labels);
    var musicPanel = createMusicPanel(config, labels);
    var pausePanel = createPausePanel(config, labels);
    var positionPanel = createPositionPanel(config, labels);
    var queryPanel = createQueryPanel(config, labels);
    var hoverPanel = createHoverTrailerPanel(config, labels);
    var trailersPanel = createTrailersPanel(config, labels);
    var studioPanel = createStudioHubsPanel(config, labels);
    var avatarPanel = createAvatarPanel(config, labels);
    var statusRatingPanel = createStatusRatingPanel(config, labels);
    var actorPanel = createActorPanel(config, labels);
    var directorPanel = createDirectorPanel(config, labels);
    var languagePanel = createLanguagePanel(config, labels);
    var logoTitlePanel = createLogoTitlePanel(config, labels);
    var descriptionPanel = createDescriptionPanel(config, labels);
    var providerPanel = createProviderPanel(config, labels);
    var buttonsPanel = createButtonsPanel(config, labels);
    var infoPanel = createInfoPanel(config, labels);
    var exporterPanel = createExporterPanel(config, labels);
    var aboutPanel = createAboutPanel(labels);
    var notificationsPanel = createNotificationsPanel(config, labels);
    var detailsModalPanel = createDetailsModalPanel(config, labels);
    var watchlistSettingsPanel = createWatchlistPanel(config, labels);
    var dbManagementPanel = createDbManagementPanel(config, labels);
    var parentalPinPanel = (config && config.currentUserIsAdmin)
      ? createParentalPinPanel(config, labels)
      : null;
    var mainPanel = createMainSettingsPanel(labels, {
        sliderPanel,
        profileChooserPanel,
        musicPanel,
        pausePanel,
        studioPanel,
        hoverPanel,
        avatarPanel,
        notificationsPanel,
        providerPanel
    });

    [
        { panel: infoPanel, title: labels.infoHeader || 'Informações de Gênero, Ano e País' },
        { panel: buttonsPanel, title: labels.buttons || 'Configurações de Botões' },
        { panel: logoTitlePanel, title: labels.logoOrTitleHeader || 'Configurações de Logo / Título' },
        { panel: descriptionPanel, title: labels.descriptionsHeader || 'Configurações de Descrição' },
        { panel: providerPanel, title: labels.providerHeader || 'Links Externos / Configurações de Provedores' },
        { panel: languagePanel, title: labels.languageInfoHeader || 'Informações de Áudio e Legendas' },
        { panel: statusRatingPanel, title: labels.statusRatingInfo || 'Configurações de Status, Avaliação e Qualidade' },
        { panel: actorPanel, title: labels.actorInfo || 'Configurações de Exibição de Atores' },
        { panel: directorPanel, title: labels.directorWriter || 'Configurações de Diretor e Escritor' },
        { panel: animationPanel, title: labels.animationSettings || 'Configurações de Animação' }
    ].forEach(function() {
        appendMergedPanelToSlider(sliderPanel, panel, title);
    });

    [
        mainPanel, sliderPanel, queryPanel, musicPanel, studioPanel, profileChooserPanel,
        pausePanel, watchlistSettingsPanel, hoverPanel, trailersPanel, notificationsPanel, detailsModalPanel,
        avatarPanel, parentalPinPanel, positionPanel, dbManagementPanel, exporterPanel, aboutPanel
    ].filter(Boolean).forEach(function(panel) {
        panel.style.display = 'none';
    });
    mainPanel.style.display = 'block';

    var panels = [
        mainPanel, sliderPanel, queryPanel, musicPanel, studioPanel, profileChooserPanel,
        pausePanel, watchlistSettingsPanel, hoverPanel, trailersPanel, notificationsPanel, detailsModalPanel,
        avatarPanel, parentalPinPanel, positionPanel, dbManagementPanel, exporterPanel, aboutPanel
    ].filter(Boolean);
    tabContent.append(...panels);

    var interactiveTabs = [
        mainTab, sliderTab, queryTab, musicTab, studioTab, profileChooserTab,
        pauseTab, watchlistSettingsTab, hoverTab, trailersTab, notificationsTab, detailsModalTab,
        avatarTab, parentalPinTab, positionTab, dbManagementTab, exporterTab, aboutTab
    ].filter(Boolean);
    interactiveTabs.forEach(function(tab) {
        tab.addEventListenerfunction() {
            var panelId = tab.getAttribute('data-tab');
            activateSettingsPanel(modal, panelId);

            setTimeoutfunction() {
                tab.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }, 10);
        });
    });

    var form = document.createElement('form');
    form.append(tabContainer, tabContent);

    var btnDiv = document.createElement('div');
    btnDiv.className = 'btn-item';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = labels.saveSettings || 'Salvar';

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = labels.apply || 'Aplicar';

    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = labels.resetToDefaults || 'Redefinir';
    resetBtn.className = 'reset-btn';
    resetBtn.onclick = function() {
        createConfirmationModal(
            labels.resetConfirm || 'Tem certeza que deseja redefinir todas as configurações para os valores padrão?',
            resetAllSettings,
            labels
        );
    };

    var saveLabel = saveBtn.textContent;
    var applyLabel = applyBtn.textContent;
    var resetLabel = resetBtn.textContent;
    var settingsActionBusy = false;

    function setBusyState(isBusy) {
      var controls = [saveBtn, applyBtn, resetBtn, themeToggleBtn].filter(Boolean);
      controls.forEach(function() {
        if (!btn) return;
        if (isBusy) {
          if (btn.__busyPrevDisabled === undefined) {
            btn.__busyPrevDisabled = btn.disabled;
            btn.__busyPrevPointerEvents = btn.style.pointerEvents;
            btn.__busyPrevOpacity = btn.style.opacity;
          }
          btn.disabled = true;
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.6';
          return;
        }

        if (btn.__busyPrevDisabled !== undefined) {
          btn.disabled = btn.__busyPrevDisabled;
          btn.style.pointerEvents = btn.__busyPrevPointerEvents || '';
          btn.style.opacity = btn.__busyPrevOpacity || '';
          delete btn.__busyPrevDisabled;
          delete btn.__busyPrevPointerEvents;
          delete btn.__busyPrevOpacity;
        }
      });

      saveBtn.textContent = isBusy ? ((labels && labels.saving) ? labels.saving : 'Salvando...') : saveLabel;
      applyBtn.textContent = isBusy ? ((labels && labels.applying) ? labels.applying : 'Aplicando...') : applyLabel;
      resetBtn.textContent = resetLabel;
    }

    function runSaveAction(reload = false) {
      if (settingsActionBusy) return;
      settingsActionBusy = true;
      setBusyState(true);

      try {
        var panelSaveHooks = (parentalPinPanel && typeof parentalPinPanel.__jmsSave === 'function') ? [parentalPinPanel.__jmsSave] : [];
        for (var i = 0; i < panelSaveHooks.length; i++) {
          var saveHook = panelSaveHooks[i];
          saveHook({ reload: reload });
        }

        var result = applySettings(reload);
        if (reload || (result && result.ok === false)) return result;

        if (result && result.forcedAdminPublish && result.publishResult && result.publishResult.attempted && result.publishResult.ok) {
          var profileLabel =
            result.publishResult.profile === 'mobile'
              ? (labels.profileMobile || 'Perfil Mobile')
              : (labels.profileDesktop || 'Perfil Desktop');
          showNotification(
            '<i class="fas fa-globe" style="margin-right: 8px;"></i> ' + String((labels && labels.forceGlobalPublishOk) ? labels.forceGlobalPublishOk : "Configurações globais publicadas para o perfil " + String(profileLabel) + "."),
            3200,
            'info'
          );
          return result;
        }

        showNotification(
          "<i class=\"fas fa-floppy-disk\" style=\"margin-right: 8px;\"></i> " + (config.languageLabels.settingsSavedModal || "Configurações salvas. Atualize a página do slider para aplicar as alterações."),
          3000,
          'info'
        );
        return result;
      } catch (err) {
        console.error('Settings save failed:', err);
        var errText =
          String(err.message || '').trim() ||
          labels.settingsSaveFailed ||
          'Não foi possível salvar as configurações.';
        showNotification(
          '<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ' + String(errText),
          4200,
          'error'
        );
        return { ok: false, error: err };
      } finally {
        settingsActionBusy = false;
        setBusyState(false);
      }
    }

    form.onsubmit = function() {
        e.preventDefault();
        runSaveAction(true);
    };

    applyBtn.onclick = function() {
        runSaveAction(false);
    };

    btnDiv.append(saveBtn, applyBtn, resetBtn);
    form.appendChild(btnDiv);

    var themeToggleBtn = document.createElement('button');
    themeToggleBtn.type = 'button';
    themeToggleBtn.className = 'theme-toggle-btn';

function setSettingsThemeToggleVisuals() {
  var cfg = getConfig();
  var currentLang = cfg.defaultLanguage || (typeof getDefaultLanguage === 'function' ? getDefaultLanguage() : null);
  var labels = (typeof getLanguageLabels === 'function' ? getLanguageLabels(currentLang) : {}) || cfg.languageLabels || {};

  themeToggleBtn.innerHTML = "<i class=\"fas fa-" + (cfg.playerTheme === 'light' ? 'moon' : 'sun') + "\"></i>";
  themeToggleBtn.title = cfg.playerTheme === 'light'
    ? (labels.darkTheme || 'Tema Escuro')
    : (labels.lightTheme || 'Tema Claro');
}

themeToggleBtn.onclick = function() {
  if (themeToggleBtn.dataset.busy === '1') return;
  themeToggleBtn.dataset.busy = '1';
  themeToggleBtn.disabled = true;
  var cfg = getConfig();
  var newTheme = cfg.playerTheme === 'light' ? 'dark' : 'light';

  try {
    updateConfig({ ...cfg, playerTheme: newTheme });
    loadCSS();

    var playerThemeBtn = document.querySelector('#modern-music-player .theme-toggle-btn');
    if (playerThemeBtn) {
      playerThemeBtn.innerHTML = "<i class=\"fas fa-" + (newTheme === 'light' ? 'moon' : 'sun') + "\"></i>";
      var labels = cfg.languageLabels || {};
      playerThemeBtn.title = newTheme === 'light'
        ? (labels.darkTheme || 'Tema Escuro')
        : (labels.lightTheme || 'Tema Claro');
    }

    setSettingsThemeToggleVisuals();

    var labels = cfg.languageLabels || {};
      showNotification(
        '<i class="fas fa-' + String(newTheme === 'light' ? 'sun' : 'moon') + '"></i> ' + String(
          newTheme === 'light'
            ? (labels.lightThemeEnabled || 'Tema claro ativado')
            : (labels.darkThemeEnabled || 'Tema escuro ativado')
        ),
        2000,
        'info'
      );
      try {
        window.dispatchEvent(new CustomEvent('app:theme-changed', { detail: { theme: newTheme } }));
        var themeSelect = document.getElementById('themeSelect');
        if (themeSelect) themeSelect.value = newTheme;
      } catch {}

    var publishResult = publishAdminSnapshotIfForced();
    if (cfg && cfg.forceGlobalUserSettings && cfg.currentUserIsAdmin && publishResult && publishResult.attempted && !publishResult.ok) {
      showNotification(
        '<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> ' + String((labels && labels.forceGlobalPublishFailed) ? labels.forceGlobalPublishFailed : 'Não foi possível publicar as configurações globais.'),
        4200,
        'error'
      );
    }
  } finally {
    delete themeToggleBtn.dataset.busy;
    themeToggleBtn.disabled = false;
  }
};

    setSettingsThemeToggleVisuals();
    btnDiv.append(themeToggleBtn);

    applyGlobalSettingsLockUI({
      labels,
      saveBtn,
      applyBtn,
      resetBtn,
      themeToggleBtn
    });

    modalContent.append(title, form);
    enhanceFormAccessibility(form, { prefix: 'settings' });
    modal.appendChild(modalContent);


    function resetAllSettings() {
        Object.keys(config).forEach(function(key) {
            localStorage.removeItem(key);
        });
        location.reload();
    }

     setTimeoutfunction() {
      setupMobileTextareaBehavior();
    }, 100);

    settingsModal = modal;
    return modal;
}

function setDocumentScrollLocked(lock) {
  var html = document.documentElement;
  var body = document.body;
  if (!html || !body) return;

  if (lock) {
    if (body.dataset.jmsPrevOverflow === undefined) {
      body.dataset.jmsPrevOverflow = body.style.overflow || '';
    }
    if (html.dataset.jmsPrevOverflow === undefined) {
      html.dataset.jmsPrevOverflow = html.style.overflow || '';
    }
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return;
  }

  if (body.dataset.jmsPrevOverflow !== undefined) {
    body.style.overflow = body.dataset.jmsPrevOverflow || '';
    delete body.dataset.jmsPrevOverflow;
  }
  if (html.dataset.jmsPrevOverflow !== undefined) {
    html.style.overflow = html.dataset.jmsPrevOverflow || '';
    delete html.dataset.jmsPrevOverflow;
  }
}

function closeLocalSettingsShell(modal) {
  if (!modal) return;

  if (modal.__overlayEscapeHandler) {
    window.removeEventListener('keydown', modal.__overlayEscapeHandler);
    delete modal.__overlayEscapeHandler;
  }
  if (modal.__overlayClickHandler) {
    modal.removeEventListener('click', modal.__overlayClickHandler);
    delete modal.__overlayClickHandler;
  }

  var modalContent = modal.querySelector('.settings-modal-content');
  if (modalContent && modalContent.__overlayStopPropagationHandler) {
    modalContent.removeEventListener('click', modalContent.__overlayStopPropagationHandler);
    delete modalContent.__overlayStopPropagationHandler;
  }

  setDocumentScrollLocked(false);
  modal.remove();

  if (settingsModal === modal) {
    settingsModal = null;
  }
}

function prepareModalForLocalShell(modal) {
  if (!modal) return modal;

  var modalContent = modal.querySelector('.settings-modal-content');
  var title = modalContent.querySelector('h2');

  modal.classList.add(SETTINGS_OVERLAY_CLASS);
  modal.classList.remove(SETTINGS_EMBEDDED_CLASS);
  modal.removeAttribute('data-jms-settings-page');

  var closeBtn = modalContent ? modalContent.querySelector('.settings-close') : null;
  if (!closeBtn && modalContent) {
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close';
    closeBtn.setAttribute('aria-label', 'Close settings');
    closeBtn.innerHTML = '&times;';
    modalContent.insertBefore(closeBtn, modalContent.firstChild);
  }

  if (closeBtn) {
    closeBtn.onclick = function() closeLocalSettingsShell(modal);
  }

  if (!modal.__overlayClickHandler) {
    modal.__overlayClickHandler = function() {
      if (event.target === modal) {
        closeLocalSettingsShell(modal);
      }
    };
    modal.addEventListener('click', modal.__overlayClickHandler);
  }

  if (modalContent && !modalContent.__overlayStopPropagationHandler) {
    modalContent.__overlayStopPropagationHandler = function() {
      event.stopPropagation();
    };
    modalContent.addEventListener('click', modalContent.__overlayStopPropagationHandler);
  }

  if (!modal.__overlayEscapeHandler) {
    modal.__overlayEscapeHandler = function() {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLocalSettingsShell(modal);
      }
    };
    window.addEventListener('keydown', modal.__overlayEscapeHandler);
  }

  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  modal.style.display = 'block';
  setDocumentScrollLocked(true);
  return modal;
}

function prepareModalForEmbeddedPage(modal) {
  if (!modal) return modal;

  var modalContent = modal.querySelector('.settings-modal-content');
  var title = modalContent.querySelector('h2');

  if (modal.__overlayEscapeHandler) {
    window.removeEventListener('keydown', modal.__overlayEscapeHandler);
    delete modal.__overlayEscapeHandler;
  }
  if (modal.__overlayClickHandler) {
    modal.removeEventListener('click', modal.__overlayClickHandler);
    delete modal.__overlayClickHandler;
  }
  if (modalContent.__overlayStopPropagationHandler) {
    modalContent.removeEventListener('click', modalContent.__overlayStopPropagationHandler);
    delete modalContent.__overlayStopPropagationHandler;
  }

  setDocumentScrollLocked(false);

  modal.classList.add(SETTINGS_EMBEDDED_CLASS);
  modal.classList.remove(SETTINGS_OVERLAY_CLASS);
  modal.setAttribute('data-jms-settings-page', 'true');
  var existingClose = modal.querySelector('.settings-close');
  if (existingClose) existingClose.remove();

  if (title) {
    title.style.display = 'none';
  }

  modal.style.display = 'block';
  return modal;
}

function activateSettingsPanel(modal, tab = 'monwui') {
    if (!modal) return null;

    var tabs = modal.querySelectorAll('.settings-tab');
    var tabContent = modal.querySelector('.settings-tab-content');
    var panels = tabContent ? Array.from(tabContent.children) : [];
    tabs.forEach(function(tabElement) tabElement.classList.remove('active'));
    panels.forEach(function(panel) {
        panel.style.display = 'none';
    });

    var targetTab = modal.querySelector(".settings-tab[data-tab=\"" + (tab) + "\"]");
    var targetPanel = modal.querySelector("#" + (tab) + "-panel");

    if (targetTab && targetPanel) {
        targetTab.classList.add('active');
        targetPanel.style.display = 'block';
        if (tabContent) {
            tabContent.scrollTop = 0;
            tabContent.scrollLeft = 0;
        }
        return targetPanel;
    }

    var fallbackTab = modal.querySelector('.settings-tab[data-tab="monwui"]')
        || modal.querySelector('.settings-tab[data-tab="slider"]');
    var fallbackPanel = modal.querySelector('#monwui-panel')
        || modal.querySelector('#slider-panel');

    if (fallbackTab) fallbackTab.classList.add('active');
    if (fallbackPanel) fallbackPanel.style.display = 'block';
    if (tabContent) {
        tabContent.scrollTop = 0;
        tabContent.scrollLeft = 0;
    }
    return fallbackPanel;
}

function createConfirmationModal(message, callback, labels) {
        var modal = document.createElement('div');
        modal.className = 'confirmation-modal';
        modal.style.display = 'block';

        var modalContent = document.createElement('div');
        modalContent.className = 'confirmation-modal-content';

        var messageEl = document.createElement('p');
        messageEl.textContent = message;

        var btnContainer = document.createElement('div');
        btnContainer.className = 'confirmation-btn-container';

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-btn';
        confirmBtn.textContent = labels.yes || 'Sim';
        confirmBtn.onclick = function() {
            callback();
            modal.remove();
        };

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.textContent = labels.no || 'Não';
        cancelBtn.onclick = function() modal.remove();

        btnContainer.append(confirmBtn, cancelBtn);
        modalContent.append(messageEl, btnContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        return modal;
    }


function createExporterPanel(config, labels) {
  var panel = document.createElement('div');
  panel.id = 'exporter-panel';
  panel.className = 'exporter-panel';

  panel.appendChild(createBackupRestoreButtons());

  document.documentElement.style.setProperty(
    '--file-select-text',
    "\"" + (config.languageLabels.chooseBackup || 'Escolher Arquivo') + "\""
  );

  return panel;
}

function createTab(id, icon, label, isActive = false, isDisabled = false) {
    var tab = document.createElement('div');
    tab.className = "settings-tab " + (isActive ? 'active' : '') + " " + (isDisabled ? 'disabled-tab' : '');
    tab.setAttribute('data-tab', id);
    tab.innerHTML = "<i class=\"fas " + (icon) + "\"></i> <span class=\"jmstab-label\">" + (label) + "</span>";

    if (isDisabled) {
        tab.style.opacity = '0.5';
        tab.style.pointerEvents = 'none';
        tab.style.cursor = 'not-allowed';
    }

    return tab;
}

function extractContainerByInput(root, inputName, closestSelector) {
    if (closestSelector === undefined) closestSelector = '.setting-item';
    var input = root ? root.querySelector('input[name="' + String(inputName) + '"]') : null;
    return (input && typeof input.closest === "function") ? input.closest(closestSelector) : null;
}

function extractContainerBySelect(root, selectName, closestSelector) {
    if (closestSelector === undefined) closestSelector = '.setting-item';
    var select = root ? root.querySelector('select[name="' + String(selectName) + '"]') : null;
    return (select && typeof select.closest === "function") ? select.closest(closestSelector) : null;
}

function extractTmdbGroup(root) {
    var keyInput = root ? root.querySelector('#tmdbKeyForReviews') : null;
    var item = (keyInput && typeof keyInput.closest === "function") ? keyInput.closest('.fsetting-item') : null;
    return item ? item.parentElement : null;
}

function extractCheckboxPair(root, inputName) {
    var input = root ? root.querySelector('input[name="' + String(inputName) + '"]') : null;
    if (!input) return null;

    var label = root.querySelector("label[for=\"" + (input.id) + "\"]");
    var wrap = document.createElement('div');
    wrap.className = 'setting-item';
    wrap.appendChild(input);
    if (label) {
        wrap.appendChild(label);
    }
    return wrap;
}

function createSettingsHotkeyField(labels, currentValue) {
    var container = document.createElement('div');
    container.className = 'hotkey-input-container';

    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.alignItems = 'center';
    container.style.gap = '5px';

    var label = document.createElement('label');
    label.htmlFor = 'settingsHotkey';
    label.textContent = labels.settingsHotkeyLabel || 'Atalho para Configurações';

    var controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '10px';
    controls.style.alignItems = 'center';
    controls.style.width = '100%';

    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'settingsHotkey';
    input.name = 'settingsHotkey';
    input.readOnly = true;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = normalizeSettingsHotkey(currentValue || getSettingsHotkey(), SETTINGS_HOTKEY_DEFAULT);
    input.style.flex = '1 1 180px';

    input.addEventListenerfunction() {
        input.focus();
        input.select();
    });

    input.addEventListenerfunction() {
        input.select();
    });

    input.addEventListenerfunction() {
        if (event.key === 'Tab') return;

        event.preventDefault();
        event.stopPropagation();

        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

        var normalizedKey = normalizeSettingsHotkey(event.key, '');
        if (!normalizedKey) return;

        input.value = normalizedKey;
        localStorage.setItem('settingsHotkey', normalizedKey);
    });

    var resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.id = 'settingsHotkeyReset';
    resetButton.className = 'reset-button';
    resetButton.textContent = labels.settingsHotkeyReset || "Redefinir para F2";
    resetButton.addEventListenerfunction() {
        input.value = SETTINGS_HOTKEY_DEFAULT;
        localStorage.setItem('settingsHotkey', SETTINGS_HOTKEY_DEFAULT);
    });

    var help = document.createElement('div');
    help.className = 'description-text';
    help.textContent =
        labels.settingsHotkeyHelp ||
        'Foque no campo e pressione a tecla que deseja usar. Padrão: F2.';
    help.style.margin = '2px 0 0';

    controls.append(input, resetButton);
    container.append(label, controls, help);
    return container;
}

function createMainSettingsPanel(labels, panels) {
    var panel = document.createElement('div');
    panel.id = 'monwui-panel';
    panel.className = 'settings-panel';

    var config = getConfig();
    var basicsSection = createSection(labels.mainCoreSettings || 'Configurações Básicas');
    var enablesSection = createSection(labels.mainEnableSettings || 'Habilitações Principais');
    var hotkeySection = createSection(labels.settingsHotkeySection || 'Atalho de Configurações');

    [
        extractContainerBySelect(panels.sliderPanel, 'defaultLanguage', '.setting-item'),
        extractTmdbGroup(panels.sliderPanel),
        extractContainerByInput(panels.sliderPanel, 'enableSlider', '.setting-item'),
        extractContainerByInput(panels.sliderPanel, 'onlyShowSliderOnHomeTab', '.setting-item')
    ].filter(Boolean).forEach(function() {
        basicsSection.appendChild(node);
    });

    var homeSectionsMaster = createCheckbox(
        'enableHomeSectionsMaster',
        labels.enableHomeSectionsMaster || 'Habilitar cartões da interface Nexus',
        config.enableHomeSectionsMaster !== false
    );
    enablesSection.appendChild(homeSectionsMaster);

    var pauseFeaturesMaster = createCheckbox(
        'enablePauseFeaturesMaster',
        labels.enablePauseFeaturesMaster || 'Habilitar recursos da tela de pausa',
        config.enablePauseFeaturesMaster !== false
    );
    enablesSection.appendChild(pauseFeaturesMaster);

    enablesSection.appendChild(createCheckbox(
        'enableSubtitleCustomizerModule',
        labels.enableSubtitleCustomizerModule || 'Habilitar Customizador de Legendas',
        config.enableSubtitleCustomizerModule !== false
    ));

    enablesSection.appendChild(createCheckbox(
        'enableParentalPinModule',
        labels.enableParentalPinModule || 'Habilitar módulo de PIN Parental',
        config.enableParentalPinModule !== false
    ));

    enablesSection.appendChild(createCheckbox(
        'enableDetailsModalModule',
        labels.enableDetailsModalModule || 'Habilitar módulo de Detalhes',
        config.enableDetailsModalModule !== false
    ));

    var castModuleSetting = extractContainerByInput(
        panels.providerPanel,
        'enableCastModule',
        '.setting-item'
    );
    if (castModuleSetting) {
        enablesSection.appendChild(castModuleSetting);
    }

    var sharedCastViewerSetting = extractContainerByInput(
        panels.providerPanel,
        'allowSharedCastViewerForUsers',
        '.setting-item'
    );
    if (sharedCastViewerSetting) {
        var castModuleSubOptions = document.createElement('div');
        castModuleSubOptions.className = 'sub-options cast-module-main-sub-options';
        castModuleSubOptions.appendChild(sharedCastViewerSetting);
        enablesSection.appendChild(castModuleSubOptions);
        bindCheckboxKontrol('#enableCastModule', '.cast-module-main-sub-options');
    }

    if (config && config.currentUserIsAdmin !== true && (castModuleSetting || sharedCastViewerSetting)) {
        var castAdminHint = document.createElement('div');
        castAdminHint.className = 'description-text';
        castAdminHint.textContent =
            labels.castModuleAdminOnlySettings ||
            'As configurações do módulo Cast e de visibilidade do usuário só podem ser alteradas por administradores.';
        enablesSection.appendChild(castAdminHint);
    }

    enablesSection.appendChild(createCheckbox(
        'enableCustomSplashScreen',
        labels.enableCustomSplashScreen || 'Habilitar tela de carregamento customizada',
        config.enableCustomSplashScreen !== false
    ));
    enablesSection.appendChild(createTextInput(
        'customSplashTitle',
        labels.customSplashTitleLabel || 'Título da Tela de Carregamento',
        config.customSplashTitle || labels.customSplashTitle || 'Nexus PobreFlix'
    ));

    [
        extractContainerByInput(panels.profileChooserPanel, 'enableProfileChooser', '.fsetting-item'),
        extractCheckboxPair(panels.musicPanel, 'enabledGmmp'),
        extractContainerByInput(panels.hoverPanel, 'allPreviewModal', '.setting-item'),
        extractContainerByInput(panels.avatarPanel, 'createAvatar', '.setting-item'),
        extractContainerByInput(panels.notificationsPanel, 'enableNotifications', '.setting-item')
    ].filter(Boolean).forEach(function() {
        enablesSection.appendChild(node);
    });

    hotkeySection.appendChild(createSettingsHotkeyField(labels, config.settingsHotkey));

    panel.append(basicsSection, enablesSection, hotkeySection);
    return panel;
}

function normalizeSectionTitle(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendMergedPanelToSlider(targetPanel, sourcePanel, title) {
    if (!targetPanel || !sourcePanel) return;

    sourcePanel.classList.remove('settings-panel');
    sourcePanel.classList.add('merged-settings-panel');
    sourcePanel.style.display = '';

    var hasSingleSection =
        sourcePanel.childElementCount === 1 &&
        (sourcePanel.firstElementChild && sourcePanel.firstElementChild.classList && sourcePanel.firstElementChild.classList.contains('settings-section'));

    var existingTitle = (hasSingleSection && sourcePanel.firstElementChild.firstElementChild && sourcePanel.firstElementChild.firstElementChild.tagName === 'H3')
        ? normalizeSectionTitle(sourcePanel.firstElementChild.firstElementChild.textContent)
        : '';

    if (hasSingleSection && existingTitle === normalizeSectionTitle(title)) {
        targetPanel.appendChild(sourcePanel);
        return;
    }

    var wrapperSection = createSection(title);
    wrapperSection.appendChild(sourcePanel);
    targetPanel.appendChild(wrapperSection);
}

export function createSection(title) {
    var section = document.createElement('div');
    section.className = 'settings-section';

    if (title) {
        var sectionTitle = document.createElement('h3');
        sectionTitle.textContent = title;
        section.appendChild(sectionTitle);
    }

    return section;
}

export function createCheckbox(name, label, isChecked) {
  var container = document.createElement('div');
  container.className = 'setting-item';

  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.name = name;
  checkbox.id = name;

  var storedValue = localStorage.getItem(name);

  if (storedValue !== null) {
    if (storedValue.trim().startsWith('{') && storedValue !== '[object Object]') {
      try {
        var obj = JSON.parse(storedValue);
        checkbox.checked = obj.enabled !== false;
      } catch {
        checkbox.checked = storedValue === 'true';
      }
    } else {
      checkbox.checked = storedValue === 'true';
    }
  } else {
    checkbox.checked = isChecked === true || isChecked === undefined;
  }

  var checkboxLabel = document.createElement('label');
  checkboxLabel.htmlFor = name;
  checkboxLabel.textContent = label;

  container.append(checkbox, checkboxLabel);
  return container;
}


export function createImageTypeSelect(name, selectedValue, includeExtended = false, includeUseSlide = false) {
    var select = document.createElement('select');
    select.name = name;

    var config = getConfig();
    var currentLang = config.defaultLanguage || getDefaultLanguage();
    var labels = getLanguageLabels(currentLang) || {};

    var options = [
        {
            value: 'none',
            label: labels.imageTypeNone || 'Nenhum'
        },
        {
            value: 'backdropUrl',
            label: labels.imageTypeBackdrop || 'Imagem de Fundo (Backdrop)'
        },
        {
            value: 'landscapeUrl',
            label: labels.imageTypeLandscape || 'Imagem de Paisagem (Landscape)'
        },
        {
            value: 'primaryUrl',
            label: labels.imageTypePoster || 'Imagem de Poster'
        },
        {
            value: 'logoUrl',
            label: labels.imageTypeLogo || 'Imagem de Logo'
        },
        {
            value: 'bannerUrl',
            label: labels.imageTypeBanner || 'Imagem de Banner'
        },
        {
            value: 'artUrl',
            label: labels.imageTypeArt || 'Imagem de Arte'
        },
        {
            value: 'discUrl',
            label: labels.imageTypeDisc || 'Imagem de Disco'
        }
    ];

    var storedValue = localStorage.getItem(name);
    var finalSelectedValue = storedValue !== null ? storedValue : selectedValue;

    options.forEach(function(option) {
        var optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        if (option.value === finalSelectedValue) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });

    return select;
}

export function bindCheckboxKontrol(
    mainCheckboxSelector,
    subContainerSelector,
    disabledOpacity = 0.5,
    additionalElements = []
) {
    setTimeoutfunction() {
        var mainCheckbox = document.querySelector(mainCheckboxSelector);
        var subContainer = document.querySelector(subContainerSelector);

        if (!mainCheckbox) return;
        var allElements = [];
        if (subContainer) {
            allElements.push(
                ...subContainer.querySelectorAll('input'),
                ...subContainer.querySelectorAll('select'),
                ...subContainer.querySelectorAll('textarea'),
                ...subContainer.querySelectorAll('label')
            );
        }
        additionalElements.forEach(function(el) el && allElements.push(el));

        var updateElementsState = function() {
            var isMainChecked = mainCheckbox.checked;

            allElements.forEach(function(element) {
                if (element.tagName === 'LABEL') {
                    element.style.opacity = isMainChecked ? '1' : disabledOpacity;
                } else {
                    element.disabled = !isMainChecked;
                    element.style.opacity = isMainChecked ? '1' : disabledOpacity;
                }
            });
            if (subContainer) {
                subContainer.style.opacity = isMainChecked ? '1' : disabledOpacity;
                subContainer.classList.toggle('disabled', !isMainChecked);
            }
        };
        updateElementsState();
        mainCheckbox.addEventListener('change', updateElementsState);
    }, 50);
}

export function bindTersCheckboxKontrol(
    mainCheckboxSelector,
    targetContainerSelector,
    disabledOpacity = 0.6,
    targetElements = []
) {
    setTimeoutfunction() {
        var mainCheckbox = document.querySelector(mainCheckboxSelector);
        var targetContainer = document.querySelector(targetContainerSelector);

        if (!mainCheckbox) return;
        var allElements = targetElements.slice();
        if (targetContainer) {
            allElements.push(
                ...targetContainer.querySelectorAll('input'),
                ...targetContainer.querySelectorAll('select'),
                ...targetContainer.querySelectorAll('textarea')
            );
        }

        var updateElementsState = function() {
            var isMainChecked = mainCheckbox.checked;
            allElements.forEach(function(element) {
                element.disabled = isMainChecked;
                element.style.opacity = isMainChecked ? disabledOpacity : '1';
            });

            if (targetContainer) {
                targetContainer.style.opacity = isMainChecked ? disabledOpacity : '1';
                targetContainer.classList.toggle('disabled', isMainChecked);
            }
        };
        updateElementsState();
        mainCheckbox.addEventListener('change', updateElementsState);
    }, 50);
}

export function initSettings(defaultTab) {
    if (defaultTab === undefined) defaultTab = 'monwui';
    var modal = createSettingsModal();

    return {
        element: modal,
        open: function(tab) {
            if (tab === undefined) tab = defaultTab;
            prepareModalForLocalShell(modal);
            return activateSettingsPanel(modal, tab);
        },
        close: function() { return closeLocalSettingsShell(modal); }
    };
}

export function mountNexusPobreFlixSettingsPage(host, options) {
    if (!host) return null;
    var defaultTab = (options && options.defaultTab) ? options.defaultTab : 'monwui';
    var force = (options && options.force === true);

    if (force) {
        var existing = host.querySelector('#settings-modal');
        if (existing) existing.remove();
        if (settingsModal && settingsModal.isConnected) settingsModal.remove();
        settingsModal = null;
    }

    var existingModal = !force ? host.querySelector('#settings-modal') : null;
    var modal = existingModal || createSettingsModal();
    prepareModalForEmbeddedPage(modal);

    if (modal.parentElement !== host) {
        host.replaceChildren(modal);
    }

    var api = {
        element: modal,
        open: function(tab) {
            if (tab === undefined) tab = defaultTab;
            prepareModalForEmbeddedPage(modal);
            return activateSettingsPanel(modal, tab);
        },
        close: function() {}
    };

    host.__nexusPobreFlixSettingsApi = api;
    api.open(defaultTab);
    return api;
}

function setupMobileTextareaBehavior() {
  var modal = document.getElementById('settings-modal');
  if (!modal) return;

  var textareas = modal.querySelectorAll('textarea');

  textareas.forEach(function(textarea) {
    textarea.addEventListener('focus', function() {
      if (!isMobileDevice()) return;
      this.style.position = 'fixed';
      this.style.bottom = '50%';
      this.style.left = '0';
      this.style.right = '0';
      this.style.zIndex = '10000';
      this.style.height = '30vh';

      setTimeoutfunction() {
        this.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 300);
    });

    textarea.addEventListener('blur', function() {
      if (!isMobileDevice()) return;
      this.style.position = '';
      this.style.bottom = '';
      this.style.left = '';
      this.style.right = '';
      this.style.zIndex = '';
      this.style.height = '';
    });
  });
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function createNumberInput(key, label, value, min = 0, max = 100, step = 1) {
  var container = document.createElement('div');
  container.className = 'input-container';

  var labelElement = document.createElement('label');
  labelElement.textContent = label;
  labelElement.htmlFor = key;
  container.appendChild(labelElement);

  var input = document.createElement('input');
  input.type = 'number';
  input.id = key;
  input.name = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);

  input.setAttribute('inputmode', 'decimal');
  input.setAttribute('pattern', '[0-9]+([\\.,][0-9]+)?');

  var normalize = function(v) { return String((v !== null && v !== undefined) ? v : '').replace(',', '.'); };
  var clamp = function(num, lo, hi) { return Math.min(Math.max(num, lo), hi); };

  input.value = normalize(value);

  input.addEventListenerfunction() {
    if (input.value.includes(',')) {
      var pos = input.selectionStart;
      input.value = input.value.replace(',', '.');
      if (pos != null) input.setSelectionRange(pos, pos);
    }
  });

  input.addEventListenerfunction() {
    var num = Number.parseFloat(normalize(input.value));
    if (!Number.isFinite(num)) return;

    var val = clamp(num, Number(input.min), Number(input.max));
    var stepNum = Number(input.step);
    if (Number.isFinite(stepNum) && stepNum > 0 && stepNum !== 1) {
      var decimals = (String(stepNum).split('.')[1] || '').length;
      val = Number(val.toFixed(decimals));
      input.value = val.toFixed(decimals);
    } else {
      input.value = String(val);
    }

    localStorage.setItem(key, input.value);
  });

  input.addEventListenerfunction() {
    var v = normalize(e.target.value);
    localStorage.setItem(key, v);
  });

  container.appendChild(input);
  return container;
}

export function createTextInput(key, label, value) {
    var container = document.createElement('div');
    container.className = 'input-container';

    var labelElement = document.createElement('label');
    labelElement.textContent = label;
    labelElement.htmlFor = key;
    container.appendChild(labelElement);

    var input = document.createElement('input');
    input.type = 'text';
    input.id = key;
    input.name = key;
    input.value = value;
    input.addEventListenerfunction() {
        localStorage.setItem(key, e.target.value);
    });
    container.appendChild(input);

    return container;
}

export function createSelect(key, label, options, selectedValue) {
    var container = document.createElement('div');
    container.className = 'input-container';

    var labelElement = document.createElement('label');
    labelElement.textContent = label;
    labelElement.htmlFor = key;
    container.appendChild(labelElement);

    var select = document.createElement('select');
    select.id = key;
    select.name = key;

    options.forEach(function(option) {
        var optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.text;
        if (option.value === selectedValue) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });

    select.addEventListenerfunction() {
        localStorage.setItem(key, e.target.value);
    });
    container.appendChild(select);

    return container;
}

var __isAdminCached = null;

function getJfRootFromLocation() {
  try {
    var baseEl = document.querySelector("base[href]");
    var baseHref = baseEl ? baseEl.getAttribute("href") : null;
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

function getEmbyTokenSafe() {
  try {
    var apiClient = window.ApiClient;
    if (!apiClient) return "";
    var token = (typeof apiClient.accessToken === "function")
      ? apiClient.accessToken()
      : (apiClient._accessToken || "");
    return token || "";
  } catch (e) {
    return "";
  }
}

function readBooleanish(value) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function readAdminFlagFromPolicy(policy) {
  if (!policy || typeof policy !== "object") return null;

  var candidates = [policy.IsAdministrator, policy.IsAdmin, policy.IsAdminUser];
  for (var candidate of candidates) {
    var normalized = readBooleanish(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
}

function readAdminFlagFromUser(user) {
  if (!user || typeof user !== "object") return null;

  var policyFlag = readAdminFlagFromPolicy(user.Policy || user.UserPolicy);
  if (policyFlag !== null) return policyFlag;

  var candidates = [user.IsAdministrator, user.isAdministrator, user.IsAdmin, user.isAdmin];
  for (var candidate of candidates) {
    var normalized = readBooleanish(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
}

function resolveLiveAdminFlag() {
  var liveCandidates = [];

  try {
    var sessionInfo = typeof getSessionInfo === "function" ? getSessionInfo() : null;
    if (sessionInfo && sessionInfo.User) liveCandidates.push(sessionInfo.User);
    if (sessionInfo && sessionInfo.user) liveCandidates.push(sessionInfo.user);
    if (sessionInfo) liveCandidates.push(sessionInfo);
  } catch (e) {}

  try {
    if (window.ApiClient._currentUser) {
      liveCandidates.push(window.ApiClient._currentUser);
    }
  } catch {}

  for (var candidate of liveCandidates) {
    var flag = readAdminFlagFromUser(candidate);
    if (flag !== null) return flag;
  }

  try {
    var apiClient = window.ApiClient;
    if (apiClient && typeof apiClient.getCurrentUser === "function") {
        var currentUser = apiClient.getCurrentUser();
        var currentFlag = readAdminFlagFromUser(currentUser);
        if (currentFlag !== null) return currentFlag;
    }
  } catch (e) {}

  try {
    var cachedFlag = readBooleanish(localStorage.getItem("currentUserIsAdmin"));
    if (cachedFlag !== null) return cachedFlag;
  } catch (e) {}

  return null;
}

function buildAdminProbeHeaders(token) {
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

function isAdminUser() {
  if (__isAdminCached !== null) return __isAdminCached;

  try {
    var liveAdmin = resolveLiveAdminFlag();
    if (liveAdmin === true) {
      __isAdminCached = true;
      return true;
    }

    var token = getEmbyTokenSafe();
    if (token) {
      var jfRoot = getJfRootFromLocation();
      var r = fetch((jfRoot) + "/Users/Me", {
        cache: "no-store",
        headers: buildAdminProbeHeaders(token)
      });

      if (r.ok) {
        var me = r.json();
        var fetchedAdmin = readAdminFlagFromUser(me);
        if (fetchedAdmin !== null) {
          __isAdminCached = fetchedAdmin;
          return fetchedAdmin;
        }
      }
    }

    if (liveAdmin !== null) {
      __isAdminCached = liveAdmin;
      return liveAdmin;
    }

    __isAdminCached = false;
    return false;
  } catch {
    __isAdminCached = false;
    return false;
  }
}

export function isGlobalSettingsLockedForUser() {
  var cfg = getConfig();
  var forced = (cfg && cfg.forceGlobalUserSettings === true);

  if (!forced) return false;
  return true;
}

function applyGlobalSettingsLockUI(args) {
  var labels = args.labels;
  var saveBtn = args.saveBtn;
  var applyBtn = args.applyBtn;
  var resetBtn = args.resetBtn;
  var themeToggleBtn = args.themeToggleBtn;

  var cfg = getConfig();
  if (!cfg || !cfg.forceGlobalUserSettings) return;

  var admin = isAdminUser();
  if (admin) return;

  var lockMsg =
    labels.forceGlobalLockedTitle ||
    "As configurações foram impostas globalmente pelo administrador neste servidor.";

  [saveBtn, applyBtn, resetBtn].forEach(function(btn) {
    if (!btn) return;
    btn.disabled = true;
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0.5";
  });
  if (themeToggleBtn) {
    themeToggleBtn.disabled = false;
    themeToggleBtn.style.pointerEvents = "";
    themeToggleBtn.style.opacity = "";
  }

  var modal = document.getElementById('settings-modal');
  if (modal) {
    var avatarPanel = modal.querySelector('#avatar-panel');
    var avatarAllowed = new Set();
    if (avatarPanel) {
      avatarPanel.querySelectorAll('input, select, textarea, button').forEach(function(el) avatarAllowed.add(el));
    }

    if (themeToggleBtn) avatarAllowed.add(themeToggleBtn);
    var settingsHotkeyInput = modal.querySelector('#settingsHotkey');
    var settingsHotkeyReset = modal.querySelector('#settingsHotkeyReset');
    if (settingsHotkeyInput) avatarAllowed.add(settingsHotkeyInput);
    if (settingsHotkeyReset) avatarAllowed.add(settingsHotkeyReset);

    modal.querySelectorAll('input, select, textarea, button').forEach(function(el) {
      if (el.classList.contains('settings-close')) return;
      if (avatarAllowed.has(el)) return;
      el.disabled = true;
      el.style.pointerEvents = "none";
      el.style.opacity = "0.6";
    });
  }

  showNotification(
    '<i class="fas fa-lock" style="margin-right:8px;"></i> ' + String(lockMsg),
    5000,
    "warning"
  );
}
